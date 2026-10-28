using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("VisibleTime")]
[assembly: AssemblyProduct("VisibleTime")]
[assembly: AssemblyCompany("dutiantian6666")]
[assembly: ComVisible(false)]

namespace VisibleTime {
    [ComVisible(true), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IBridge {
        [DispId(1)] string Call(string operation, string arguments);
    }
    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public sealed class Bridge : IBridge {
        private readonly MainWindow owner;
        internal Bridge(MainWindow owner) { this.owner = owner; }
        public string Call(string operation, string arguments) {
            try {
                if (owner.Web.Source == null || owner.Web.Source.AbsoluteUri != MainWindow.Page) throw new InvalidOperationException("Untrusted page.");
                var args = Json.Codec.DeserializeObject(arguments) as object[];
                object value;
                switch (operation) {
                    case "load": value = owner.Store.Raw(); break;
                    case "save":
                        owner.Store.Save((string)args[0], (string)args[1]);
                        owner.BeginInvoke(new Action(owner.UpdateTray));
                        value = args[0]; break;
                    case "info": value = new { version = Application.ProductVersion.Substring(0, Application.ProductVersion.LastIndexOf('.')), directory = owner.Store.DirectoryPath, recovered = owner.Store.Recovered }; break;
                    case "test":
                        if (!Program.Test) throw new InvalidOperationException("Unavailable.");
                        value = owner.TestCommand(args); break;
                    default: throw new InvalidOperationException("Unknown operation.");
                }
                return Json.Encode(new { ok = true, value = value });
            } catch (Exception error) { return Json.Encode(new { ok = false, error = error.Message }); }
        }
    }

    internal sealed class MainWindow : Form {
        internal const string Page = "https://visibletime.local/index.html";
        internal readonly Store Store;
        internal readonly WebView2 Web = new WebView2();
        private readonly NotifyIcon tray = new NotifyIcon();
        private readonly System.Windows.Forms.Timer heartbeat = new System.Windows.Forms.Timer { Interval = 5000 };
        private readonly System.Windows.Forms.Timer activate = new System.Windows.Forms.Timer { Interval = 500 };
        private bool quitting;
        private bool failed;
        private bool initialized;
        private const int WmQueryEndSession = 0x11;
        private const int WmEndSession = 0x16;
        private const int WmPowerBroadcast = 0x218;
        private string testExport;
        private string testImport;
        private bool testConfirm;
        internal MainWindow(string directory) {
            Store = new Store(Path.Combine(directory, "data"));
            Text = "VisibleTime";
            Width = 1260; Height = 960;
            MinimumSize = new Size(780, 660);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(245, 244, 238);
            Icon = new Icon(Path.Combine(Application.StartupPath, "icon.ico"));
            Web.Dock = DockStyle.Fill;
            Controls.Add(Web);
            tray.Icon = Icon;
            tray.Text = "VisibleTime";
            tray.Visible = true;
            tray.MouseClick += delegate(object sender, MouseEventArgs e) { if (e.Button == MouseButtons.Left) ShowMain(); };
            UpdateTray();
            heartbeat.Tick += delegate { Guard(delegate { Store.Heartbeat(); }); };
            activate.Tick += delegate { if (Program.Activation.WaitOne(0)) ShowMain(); };
            activate.Start();
            FormClosing += ClosingWindow;
            Shown += async delegate {
                if (Program.Test) Hide();
                try { await Initialize(directory); }
                catch (Exception error) { Fatal("无法启动窗口。请检查 Microsoft Edge WebView2 Runtime。\n" + error.Message); }
            };
        }
        private async Task Initialize(string directory) {
            var options = new CoreWebView2EnvironmentOptions();
            if (Program.Test) {
                var port = Environment.GetEnvironmentVariable("VISIBLE_TIME_DEBUG_PORT");
                int parsed;
                if (!int.TryParse(port, out parsed) || parsed < 1024 || parsed > 65535) throw new InvalidOperationException("Invalid test port.");
                options.AdditionalBrowserArguments = "--remote-debugging-port=" + parsed + " --remote-debugging-address=127.0.0.1";
            }
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(directory, "webview"), options);
            await Web.EnsureCoreWebView2Async(environment);
            var core = Web.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping("visibletime.local", Path.Combine(Application.StartupPath, "ui"), CoreWebView2HostResourceAccessKind.DenyCors);
            core.Settings.AreDevToolsEnabled = Program.Test;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.AddHostObjectToScript("bridge", new Bridge(this));
            core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { if (e.Uri != Page) e.Cancel = true; };
            core.FrameNavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { e.Cancel = true; };
            core.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
            core.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Deny; };
            core.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs e) { e.Cancel = true; };
            core.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs e) {
                if (!quitting && (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited ||
                    e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited ||
                    e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)) {
                    Guard(delegate { Store.Pause(); });
                    Fatal("界面运行环境意外停止，记录已保存。请重新启动应用。\n" + e.ProcessFailedKind);
                }
            };
            core.WebMessageReceived += Message;
            // Limit the native bridge and local files to the packaged application origin.
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs e) {
                var uri = new Uri(e.Request.Uri);
                var allowed = new[] { "/index.html", "/styles.css", "/app.js", "/core.js", "/history.js", "/calendar.js", "/favicon.svg" };
                if (uri.Scheme != "https" || uri.Host != "visibletime.local" || !allowed.Contains(uri.AbsolutePath)) {
                    e.Response = environment.CreateWebResourceResponse(null, 403, "Forbidden", "Content-Type: text/plain");
                }
            };
            await core.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(Path.Combine(Application.StartupPath, "bridge.js")));
            core.Navigate(Page);
            initialized = true;
            heartbeat.Start();
        }
        internal void ShowMain() {
            Show(); WindowState = FormWindowState.Normal; Activate();
        }
        internal void UpdateTray() {
            var state = Json.State(Store.Raw());
            string taskId = null;
            foreach (var item in Json.Items(state, "sessions")) {
                var session = Json.Object(item);
                if (session["end"] == null) taskId = (string)session["taskId"];
            }
            var title = "当前没有正在计时的任务";
            foreach (var item in Json.Items(state, "tasks")) {
                var task = Json.Object(item);
                if ((string)task["id"] == taskId) title = "正在专注：" + (string)task["name"];
            }
            tray.Text = title.Length > 60 ? title.Substring(0, 60) : title;
            var menu = new ContextMenuStrip();
            menu.Items.Add("打开 VisibleTime", null, delegate { ShowMain(); });
            menu.Items.Add(new ToolStripMenuItem(title) { Enabled = false });
            var pause = menu.Items.Add("暂停计时", null, delegate { Guard(delegate { Store.Pause(); Changed("已从托盘暂停计时。"); }); });
            pause.Enabled = taskId != null;
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("打开数据文件夹", null, delegate { Process.Start("explorer.exe", Store.DirectoryPath); });
            menu.Items.Add("退出并暂停计时", null, delegate { Quit(); });
            var previous = tray.ContextMenuStrip;
            tray.ContextMenuStrip = menu;
            if (previous != null) previous.Dispose();
        }
        private void Changed(string message) {
            UpdateTray();
            if (initialized) Web.CoreWebView2.PostWebMessageAsJson(Json.Encode(new { type = "changed", message = message }));
        }
        private void Guard(Action action) { try { action(); } catch (Exception error) { Fatal("数据保存失败，请保留数据库和备份。\n" + error.Message); } }
        private void Fatal(string message) {
            if (failed) return;
            failed = true;
            heartbeat.Stop();
            if (Program.Test) File.WriteAllText(Path.Combine(Store.DirectoryPath, "fatal.txt"), message);
            else MessageBox.Show(message, "VisibleTime", MessageBoxButtons.OK, MessageBoxIcon.Error);
            // Do not advance the heartbeat after a storage failure.
            quitting = true;
            Close();
        }
        private void Message(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
            if (e.Source != Page) return;
            var id = 0;
            try {
                var request = Json.Object(Json.Codec.DeserializeObject(e.WebMessageAsJson));
                id = Convert.ToInt32(request["id"]);
                var operation = (string)request["operation"];
                var result = new Dictionary<string, object> { { "id", id }, { "ok", true } };
                switch (operation) {
                    case "backup": result["file"] = Store.Backup("manual"); break;
                    case "open": Process.Start("explorer.exe", Store.DirectoryPath); break;
                    case "quit":
                        BeginInvoke(new Action(Quit));
                        break;
                    case "export":
                        var exportFile = testExport;
                        if (!Program.Test) using (var dialog = new SaveFileDialog { Title = "导出 VisibleTime 数据", Filter = "VisibleTime 备份|*.json", FileName = "VisibleTime-backup-" + DateTime.Now.ToString("yyyy-MM-dd") + ".json" }) {
                            if (dialog.ShowDialog(this) == DialogResult.OK) exportFile = dialog.FileName;
                        }
                        if (String.IsNullOrEmpty(exportFile)) result["canceled"] = true;
                        else { Store.Export(exportFile); result["file"] = exportFile; }
                        break;
                    case "import":
                        var importFile = testImport;
                        if (!Program.Test) using (var dialog = new OpenFileDialog { Title = "导入数据或恢复备份", Filter = "VisibleTime 备份|*.json" }) {
                            if (dialog.ShowDialog(this) == DialogResult.OK) importFile = dialog.FileName;
                        }
                        if (String.IsNullOrEmpty(importFile)) { result["canceled"] = true; break; }
                        var state = Store.ReadBackup(importFile);
                        var confirmed = Program.Test ? testConfirm : MessageBox.Show(this,
                            "导入 " + Json.Items(state, "tasks").Length + " 项任务、" + Json.Items(state, "sessions").Length + " 段记录？\n将替换当前数据，替换前自动保存备份。",
                            "确认导入", MessageBoxButtons.OKCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.OK;
                        if (!confirmed) result["canceled"] = true;
                        else { result["file"] = Store.Import(state); Changed("数据已导入；原有数据已自动备份。"); }
                        break;
                    default: throw new InvalidOperationException("Unknown operation.");
                }
                Web.CoreWebView2.PostWebMessageAsJson(Json.Encode(result));
            } catch (Exception error) { Web.CoreWebView2.PostWebMessageAsJson(Json.Encode(new { id = id, ok = false, error = error.Message })); }
        }
        internal object TestCommand(object[] args) {
            var action = (string)args[0];
            switch (action) {
                case "hide": BeginInvoke(new Action(delegate { Close(); })); return true;
                case "visible": return Visible;
                case "suspend": BeginInvoke(new Action(delegate { SendMessage(Handle, WmPowerBroadcast, new IntPtr(4), IntPtr.Zero); })); return true;
                case "resume": BeginInvoke(new Action(delegate { SendMessage(Handle, WmPowerBroadcast, new IntPtr(7), IntPtr.Zero); })); return true;
                case "dialogs":
                    var settings = Json.Object(args[1]);
                    testImport = Json.Get(settings, "importFile") as string;
                    testExport = Json.Get(settings, "exportFile") as string;
                    testConfirm = Object.Equals(Json.Get(settings, "confirm"), true);
                    return true;
                default: throw new InvalidOperationException("Unknown test command.");
            }
        }
        private void Quit() {
            Guard(delegate { Store.Pause(); Store.Backup("exit"); quitting = true; Close(); });
        }
        private void ClosingWindow(object sender, FormClosingEventArgs e) {
            if (e.CloseReason == CloseReason.UserClosing && !quitting) { e.Cancel = true; Hide(); return; }
            if (!quitting) { try { Store.Pause(); Store.Backup("exit"); } catch (Exception error) { if (!failed) Fatal(error.Message); } }
            heartbeat.Stop(); activate.Stop();
            tray.Visible = false;
            tray.Dispose();
            Web.Dispose();
            Store.Dispose();
        }
        protected override void WndProc(ref System.Windows.Forms.Message message) {
            if ((message.Msg == WmPowerBroadcast && message.WParam.ToInt32() == 4) ||
                message.Msg == WmQueryEndSession || (message.Msg == WmEndSession && message.WParam != IntPtr.Zero)) {
                Guard(delegate { Store.Pause(); Changed("系统休眠或退出，计时已自动暂停。"); });
            }
            base.WndProc(ref message);
        }
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    }
    internal static class Program {
        internal static readonly bool Test = Environment.GetEnvironmentVariable("VISIBLE_TIME_TEST") == "1";
        internal static EventWaitHandle Activation;
        [STAThread] private static void Main(string[] args) {
            if (args.Length == 1 && args[0] == "--check-runtime") {
                try {
                    var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
                    Environment.ExitCode = int.Parse(version.Split('.')[0]) >= 109 ? 0 : 1;
                } catch { Environment.ExitCode = 1; }
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VisibleTime");
            if (Test && !String.IsNullOrEmpty(Environment.GetEnvironmentVariable("VISIBLE_TIME_DATA_DIR"))) directory = Environment.GetEnvironmentVariable("VISIBLE_TIME_DATA_DIR");
            var suffix = Test ? Path.GetFileName(directory) : Environment.UserName;
            bool created;
            using (var mutex = new Mutex(true, "Local\\VisibleTime.Native." + suffix, out created)) {
                Activation = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\VisibleTime.Activate." + suffix);
                if (!created) { Activation.Set(); Activation.Dispose(); return; }
                try {
                    if (!Test && Process.GetProcessesByName("VisibleTime").Any(process => process.Id != Process.GetCurrentProcess().Id)) {
                        MessageBox.Show("请先退出正在运行的 VisibleTime 旧版本，再打开新版。", "VisibleTime");
                        return;
                    }
                    using (var window = new MainWindow(directory)) Application.Run(window);
                } catch (Exception error) {
                    if (Test) { Directory.CreateDirectory(directory); File.WriteAllText(Path.Combine(directory, "startup-error.txt"), error.ToString()); }
                    else MessageBox.Show("无法打开 VisibleTime，现有数据不会被重置。\n" + error.Message, "VisibleTime", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    Environment.ExitCode = 1;
                } finally { Activation.Dispose(); mutex.ReleaseMutex(); }
            }
        }
    }
}
