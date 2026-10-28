const { contextBridge, ipcRenderer } = require("electron");

function sync(channel, ...args) {
  const result = ipcRenderer.sendSync(channel, ...args);
  if (!result?.ok) throw new Error(result?.error || "本地数据库暂不可用。");
  return result.value;
}

contextBridge.exposeInMainWorld("desktop", {
  load: () => sync("state:load"),
  save: (raw, expected) => sync("state:save", raw, expected),
  info: () => sync("app:info"),
  exportBackup: () => ipcRenderer.invoke("backup:export"),
  importBackup: () => ipcRenderer.invoke("backup:import"),
  backupNow: () => ipcRenderer.invoke("backup:create"),
  openData: () => ipcRenderer.invoke("data:open"),
  quit: () => ipcRenderer.invoke("app:quit"),
  onChange: callback => {
    ipcRenderer.on("state:changed", (_event, message) => callback(message));
  },
});
