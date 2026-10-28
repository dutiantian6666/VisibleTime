import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, protocol, net, dialog, shell, powerMonitor } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { Store, decodeBackup } from "./store.mjs";
import { activeSession } from "../core.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const testMode = process.env.VISIBLE_TIME_TEST === "1";
if (testMode && process.env.VISIBLE_TIME_DATA_DIR) app.setPath("userData", process.env.VISIBLE_TIME_DATA_DIR);
else app.setPath("userData", path.join(app.getPath("appData"), "VisibleTime"));
app.setName("VisibleTime");
app.setAppUserModelId("com.dutiantian6666.visibletime");
protocol.registerSchemesAsPrivileged([{
  scheme: "visibletime",
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

const locked = app.requestSingleInstanceLock();
let window;
let tray;
let store;
let quitting = false;
let heartbeat;
let fatal = false;

function showWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function changed(message) {
  if (window && !window.isDestroyed()) window.webContents.send("state:changed", message);
  updateTray();
}

function updateTray() {
  if (!tray || !store) return;
  const state = store.load();
  const active = activeSession(state);
  const task = state.tasks.find(item => item.id === active?.taskId);
  tray.setToolTip(task ? `VisibleTime · 正在专注：${task.name}` : "VisibleTime · 看见时间");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 VisibleTime", click: showWindow },
    { label: task ? `正在专注：${task.name.slice(0, 30)}` : "当前没有正在计时的任务", enabled: false },
    { label: "暂停计时", enabled: Boolean(active), click: () => pause("已从托盘暂停计时。") },
    { type: "separator" },
    { label: "打开数据文件夹", click: () => shell.openPath(store.directory) },
    { label: "退出并暂停计时", click: () => app.quit() },
  ]));
}

function storageFailure(error) {
  if (fatal) return;
  fatal = true;
  clearInterval(heartbeat);
  dialog.showErrorBox("VisibleTime 数据保存失败", `计时已停止，请保留数据文件并检查磁盘空间。\n${error.message}`);
  app.exit(1);
}

function pause(message) {
  try {
    store.pause();
    changed(message);
  } catch (error) { storageFailure(error); }
}

function trusted(event) {
  const url = new URL(event.senderFrame.url);
  return event.sender === window?.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    url.protocol === "visibletime:" && url.hostname === "app" && url.pathname === "/index.html";
}

function registerSync(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    try {
      if (!trusted(event)) throw new Error("请求来源无效。");
      event.returnValue = { ok: true, value: handler(...args) };
    } catch (error) {
      event.returnValue = { ok: false, error: error.message };
    }
  });
}

function registerAsync(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (!trusted(event)) throw new Error("请求来源无效。");
      return { ok: true, ...(await handler(...args)) };
    } catch (error) { return { ok: false, error: error.message }; }
  });
}

async function ready() {
  try {
    store = new Store(path.join(app.getPath("userData"), "data"));
  } catch (error) {
    dialog.showErrorBox("无法打开 VisibleTime 数据库", `现有数据库不会被重置。请保留数据目录和备份。\n${error.message}`);
    app.exit(1);
    return;
  }
  const allowed = new Set(["index.html", "styles.css", "app.js", "core.js", "history.js", "favicon.svg"]);
  protocol.handle("visibletime", request => {
    const url = new URL(request.url);
    const name = url.pathname.slice(1);
    if (url.host !== "app" || !allowed.has(name)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(path.join(root, name)).toString());
  });
  const icon = nativeImage.createFromPath(path.join(root, "desktop", "assets", "icon.png"));
  window = new BrowserWindow({
    width: 1240, height: 920, minWidth: 760, minHeight: 620,
    title: "VisibleTime", backgroundColor: "#f5f4ee", show: false, icon,
    webPreferences: {
      preload: path.join(root, "desktop", "preload.cjs"),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      backgroundThrottling: true,
    },
  });
  Menu.setApplicationMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== "visibletime://app/index.html") event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on("close", event => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  tray = new Tray(icon.resize({ width: 24, height: 24 }));
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
  updateTray();

  registerSync("state:load", () => store.raw());
  registerSync("state:save", (raw, expected) => {
    const result = store.saveRaw(raw, expected);
    updateTray();
    return result;
  });
  registerSync("app:info", () => ({
    version: app.getVersion(), directory: store.directory, recovered: store.recovered,
  }));
  registerAsync("backup:create", () => ({ file: store.backup() }));
  registerAsync("data:open", async () => {
    const error = await shell.openPath(store.directory);
    if (error) throw new Error(error);
    return {};
  });
  registerAsync("backup:export", async () => {
    const result = await dialog.showSaveDialog(window, {
      title: "导出 VisibleTime 数据", defaultPath: `VisibleTime-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "VisibleTime 备份", extensions: ["json"] }],
    });
    if (result.canceled) return { canceled: true };
    store.exportFile(result.filePath);
    return { file: result.filePath };
  });
  registerAsync("backup:import", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "导入网页版数据或恢复备份", properties: ["openFile"],
      filters: [{ name: "VisibleTime 数据", extensions: ["json"] }],
    });
    if (result.canceled) return { canceled: true };
    const file = result.filePaths[0];
    const next = decodeBackup(readFileSync(file, "utf8"));
    const current = store.load();
    const confirmation = await dialog.showMessageBox(window, {
      type: "question", title: "确认导入数据",
      message: `导入 ${next.tasks.length} 项任务、${next.sessions.length} 段计时记录？`,
      detail: `当前有 ${current.tasks.length} 项任务。导入会替换当前记录，替换前会自动保存一份备份。导入中的运行计时会结束在导出时刻。`,
      buttons: ["取消", "导入并替换"], defaultId: 0, cancelId: 0,
    });
    if (confirmation.response !== 1) return { canceled: true };
    const imported = store.importFile(file);
    changed("数据已导入；原有数据已自动备份。");
    return { file: imported.previousBackup };
  });
  registerAsync("app:quit", () => {
    setImmediate(() => app.quit());
    return {};
  });
  heartbeat = setInterval(() => {
    try { store.heartbeat(); store.ensureDailyBackup(); } catch (error) { storageFailure(error); }
  }, 5000);
  powerMonitor.on("suspend", () => pause("电脑休眠，计时已自动暂停。"));
  powerMonitor.on("shutdown", () => pause("系统正在关闭，计时已保存。"));
  window.on("query-session-end", () => pause("系统正在退出，计时已保存。"));
  window.once("ready-to-show", () => { if (!testMode) showWindow(); });
  await window.loadURL("visibletime://app/index.html");
}

if (!locked) app.quit();
else {
  app.on("second-instance", showWindow);
  app.whenReady().then(ready).catch(error => {
    dialog.showErrorBox("VisibleTime 无法启动", error.message);
    app.exit(1);
  });
  app.on("before-quit", event => {
    quitting = true;
    clearInterval(heartbeat);
    if (store) {
      try { store.pause(); store.backup("exit"); }
      catch (error) {
        event.preventDefault();
        quitting = false;
        storageFailure(error);
      }
    }
  });
  app.on("will-quit", () => { tray?.destroy(); store?.close(); });
  app.on("activate", showWindow);
}
