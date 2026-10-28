using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

namespace VisibleTime {
    internal static class Json {
        internal const int Limit = 20 * 1024 * 1024;
        internal static readonly JavaScriptSerializer Codec = new JavaScriptSerializer { MaxJsonLength = Limit, RecursionLimit = 100 };
        internal static string Encode(object value) { return Codec.Serialize(value); }
        internal static Dictionary<string, object> Object(object value) {
            var result = value as Dictionary<string, object>;
            if (result == null) throw new InvalidDataException("Invalid object.");
            return result;
        }
        internal static object Get(Dictionary<string, object> value, string key) {
            object result;
            return value.TryGetValue(key, out result) ? result : null;
        }
        internal static long Number(object value) {
            if (!(value is int || value is long || value is decimal || value is double)) throw new InvalidDataException("Invalid timestamp.");
            var number = Convert.ToDecimal(value);
            if (number < 0 || number > 8640000000000000m || decimal.Truncate(number) != number) throw new InvalidDataException("Invalid timestamp.");
            return (long)number;
        }
        internal static long Now() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }
        internal static object[] Items(Dictionary<string, object> state, string key) {
            var array = Get(state, key) as object[];
            if (array == null) throw new InvalidDataException("Invalid " + key);
            return array;
        }
        internal static Dictionary<string, object> State(string raw) {
            if (raw == null || Encoding.UTF8.GetByteCount(raw) > Limit) throw new InvalidDataException("Data exceeds 20 MB.");
            var state = Object(Codec.DeserializeObject(raw));
            if (Number(Get(state, "version")) != 1) throw new InvalidDataException("Unsupported data version.");
            var tasks = new Dictionary<string, Dictionary<string, object>>();
            foreach (var item in Items(state, "tasks")) {
                var task = Object(item);
                var id = Get(task, "id") as string;
                var name = Get(task, "name") as string;
                if (String.IsNullOrEmpty(id) || tasks.ContainsKey(id) || String.IsNullOrWhiteSpace(name) || name.Length > 80 ||
                    !(Get(task, "completed") is bool) || !task.ContainsKey("completedAt")) throw new InvalidDataException("Invalid task.");
                Number(Get(task, "createdAt"));
                var completedAt = Get(task, "completedAt");
                if (completedAt != null) Number(completedAt);
                if ((bool)task["completed"] != (completedAt != null)) throw new InvalidDataException("Invalid completion.");
                tasks.Add(id, task);
            }
            var plans = new Dictionary<string, Dictionary<string, object>>();
            if (state.ContainsKey("plans")) foreach (var item in Items(state, "plans")) {
                var plan = Object(item);
                var id = Get(plan, "id") as string;
                var taskId = Get(plan, "taskId") as string;
                var start = Number(Get(plan, "start"));
                var end = Number(Get(plan, "end"));
                if (String.IsNullOrEmpty(id) || plans.ContainsKey(id) || taskId == null || !tasks.ContainsKey(taskId) ||
                    end <= start || start % 60000 != 0 || end % 60000 != 0 || !(Get(plan, "completed") is bool))
                    throw new InvalidDataException("Invalid plan.");
                Number(Get(plan, "createdAt"));
                if (plan.ContainsKey("note") && (!(plan["note"] is string) || ((string)plan["note"]).Length > 200)) throw new InvalidDataException("Invalid plan note.");
                plans.Add(id, plan);
            }
            var ids = new HashSet<string>();
            var running = 0;
            foreach (var item in Items(state, "sessions")) {
                var session = Object(item);
                var id = Get(session, "id") as string;
                var taskId = Get(session, "taskId") as string;
                if (String.IsNullOrEmpty(id) || !ids.Add(id) || taskId == null || !tasks.ContainsKey(taskId) || !session.ContainsKey("end"))
                    throw new InvalidDataException("Invalid session.");
                var start = Number(Get(session, "start"));
                var end = Get(session, "end");
                if (end != null && Number(end) < start) throw new InvalidDataException("Invalid interval.");
                if (end == null && (++running > 1 || (bool)tasks[taskId]["completed"])) throw new InvalidDataException("Invalid active session.");
                if (session.ContainsKey("source") && !new object[] { "timer", "manual" }.Contains(session["source"])) throw new InvalidDataException("Invalid source.");
                if (session.ContainsKey("note") && (!(session["note"] is string) || ((string)session["note"]).Length > 200)) throw new InvalidDataException("Invalid note.");
                if (session.ContainsKey("planId")) {
                    var planId = session["planId"] as string;
                    if (planId == null || !plans.ContainsKey(planId) || !object.Equals(plans[planId]["taskId"], taskId)) throw new InvalidDataException("Invalid plan link.");
                }
                foreach (var key in new[] { "editedAt", "originalStart", "originalEnd" }) if (session.ContainsKey(key)) Number(session[key]);
            }
            return state;
        }
        internal static bool Stop(Dictionary<string, object> state, long now) {
            var changed = false;
            foreach (var item in Items(state, "sessions")) {
                var session = Object(item);
                if (session["end"] == null) { session["end"] = Math.Max(Number(session["start"]), now); changed = true; }
            }
            return changed;
        }
        internal static Dictionary<string, object> DecodeBackup(string raw) {
            if (Encoding.UTF8.GetByteCount(raw) > Limit) throw new InvalidDataException("Backup exceeds 20 MB.");
            var value = Object(Codec.DeserializeObject(raw));
            var wrapped = object.Equals(Get(value, "format"), "visible-time-backup");
            var cutoff = Now();
            if (wrapped) {
                if (Number(Get(value, "formatVersion")) != 1) throw new InvalidDataException("Unsupported backup version.");
                cutoff = Math.Min(cutoff, Number(Get(value, "exportedAt")));
            }
            var state = State(wrapped ? Encode(Get(value, "state")) : raw);
            Stop(state, cutoff);
            return state;
        }
    }

    internal sealed class Store : IDisposable {
        internal readonly string DirectoryPath;
        internal readonly string Backups;
        internal bool Recovered;
        private IntPtr db;
        private string backupDate;
        private static readonly IntPtr Transient = new IntPtr(-1);
        private static byte[] Utf8(string value) { return Encoding.UTF8.GetBytes(value + "\0"); }
        private static string ReadUtf8(IntPtr pointer) {
            if (pointer == IntPtr.Zero) return "";
            var size = 0;
            while (Marshal.ReadByte(pointer, size) != 0) size++;
            var buffer = new byte[size];
            Marshal.Copy(pointer, buffer, 0, size);
            return Encoding.UTF8.GetString(buffer);
        }
        private void Check(int code) {
            if (code != 0) throw new IOException("SQLite: " + ReadUtf8(sqlite3_errmsg(db)));
        }
        private IntPtr Prepare(string sql, params object[] values) {
            IntPtr statement;
            Check(sqlite3_prepare_v2(db, Utf8(sql), -1, out statement, IntPtr.Zero));
            try {
                for (int index = 0; index < values.Length; index++) {
                    if (values[index] is string) {
                        var bytes = Encoding.UTF8.GetBytes((string)values[index]);
                        Check(sqlite3_bind_text(statement, index + 1, bytes, bytes.Length, Transient));
                    } else Check(sqlite3_bind_int64(statement, index + 1, Convert.ToInt64(values[index])));
                }
                return statement;
            } catch { sqlite3_finalize(statement); throw; }
        }
        private void Execute(string sql, params object[] values) {
            var statement = Prepare(sql, values);
            try {
                var result = sqlite3_step(statement);
                if (result != 101 && result != 100) Check(result);
            } finally { sqlite3_finalize(statement); }
        }
        internal Store(string directory) {
            DirectoryPath = Path.GetFullPath(directory);
            Backups = Path.Combine(DirectoryPath, "backups");
            Directory.CreateDirectory(Backups);
            Check(sqlite3_open_v2(Utf8(Path.Combine(DirectoryPath, "visible-time.db")), out db, 2 | 4 | 0x10000, IntPtr.Zero));
            try {
                Execute("PRAGMA journal_mode=WAL");
                Execute("PRAGMA synchronous=FULL");
                Execute("PRAGMA busy_timeout=5000");
                Execute("CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id=1), payload TEXT NOT NULL, heartbeat INTEGER NOT NULL)");
                Execute("INSERT OR IGNORE INTO app_state VALUES (1, ?, ?)", "{\"version\":1,\"tasks\":[],\"sessions\":[]}", Json.Now());
                var statement = Prepare("SELECT payload, heartbeat FROM app_state WHERE id=1");
                try {
                    if (sqlite3_step(statement) != 100) throw new IOException("Missing saved state.");
                    var state = Json.State(ReadUtf8(sqlite3_column_text(statement, 0)));
                    Recovered = Json.Stop(state, Math.Min(sqlite3_column_int64(statement, 1), Json.Now()));
                    if (Recovered) Write(Json.Encode(state));
                } finally { sqlite3_finalize(statement); }
                Daily();
            } catch { Dispose(); throw; }
        }
        internal string Raw() {
            var statement = Prepare("SELECT payload FROM app_state WHERE id=1");
            try {
                if (sqlite3_step(statement) != 100) throw new IOException("Cannot read saved state.");
                return ReadUtf8(sqlite3_column_text(statement, 0));
            } finally { sqlite3_finalize(statement); }
        }
        private void Write(string raw) { Execute("UPDATE app_state SET payload=?, heartbeat=? WHERE id=1", raw, Json.Now()); }
        internal void Save(string raw, string expected) {
            Json.State(raw);
            Execute("BEGIN IMMEDIATE");
            try {
                if (Raw() != expected) throw new InvalidOperationException("记录已更新，请刷新后重试。");
                Write(raw);
                Execute("COMMIT");
            } catch { Execute("ROLLBACK"); throw; }
        }
        internal void Pause() {
            var state = Json.State(Raw());
            Json.Stop(state, Json.Now());
            Write(Json.Encode(state));
        }
        internal void Heartbeat() { Execute("UPDATE app_state SET heartbeat=? WHERE id=1", Json.Now()); Daily(); }
        internal void Daily() {
            var date = DateTime.UtcNow.ToString("yyyy-MM-dd");
            if (date == backupDate) return;
            if (!Directory.EnumerateFiles(Backups, date + "*-daily-*.json").Any()) Backup("daily");
            backupDate = date;
        }
        private string Envelope() {
            return Json.Encode(new { format = "visible-time-backup", formatVersion = 1, exportedAt = Json.Now(), state = Json.State(Raw()) });
        }
        internal static void Atomic(string file, string contents) {
            var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                    var bytes = new UTF8Encoding(false).GetBytes(contents);
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }
                if (File.Exists(file)) File.Replace(temporary, file, null);
                else File.Move(temporary, file);
            } finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        internal string Backup(string reason) {
            var file = Path.Combine(Backups, DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss.fff") + "-" + reason + "-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".json");
            Atomic(file, Envelope());
            return file;
        }
        internal void Export(string file) { Atomic(file, Envelope()); }
        internal static Dictionary<string, object> ReadBackup(string file) {
            if (new FileInfo(file).Length > Json.Limit) throw new InvalidDataException("文件过大，最多支持 20 MB。");
            return Json.DecodeBackup(File.ReadAllText(file, Encoding.UTF8));
        }
        internal string Import(Dictionary<string, object> state) {
            var backup = Backup("before-import");
            Write(Json.Encode(state));
            return backup;
        }
        public void Dispose() { if (db != IntPtr.Zero) { sqlite3_close(db); db = IntPtr.Zero; } }

        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] private static extern int sqlite3_open_v2(byte[] file, out IntPtr db, int flags, IntPtr vfs);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] private static extern int sqlite3_close(IntPtr db);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr sqlite3_errmsg(IntPtr db);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] private static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int size, out IntPtr statement, IntPtr tail);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] private static extern int sqlite3_bind_text(IntPtr statement, int index, byte[] text, int size, IntPtr destructor);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] private static extern int sqlite3_bind_int64(IntPtr statement, int index, long value);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] private static extern int sqlite3_step(IntPtr statement);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] private static extern int sqlite3_finalize(IntPtr statement);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr sqlite3_column_text(IntPtr statement, int column);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] private static extern long sqlite3_column_int64(IntPtr statement, int column);
    }
}
