(() => {
  if (location.origin !== "https://visibletime.local" || window !== window.top) return;
  const bridge = chrome.webview.hostObjects.sync.bridge;
  const call = (operation, ...args) => {
    const result = JSON.parse(bridge.Call(operation, JSON.stringify(args)));
    if (!result.ok) throw new Error(result.error || "本地数据库暂不可用。");
    return result.value;
  };
  const pending = new Map();
  let sequence = 0;
  const request = operation => new Promise(resolve => {
    const id = ++sequence;
    pending.set(id, resolve);
    chrome.webview.postMessage({ id, operation });
  });
  let onChange = () => {};
  chrome.webview.addEventListener("message", event => {
    if (event.data.type === "changed") onChange(event.data.message);
    else {
      pending.get(event.data.id)?.(event.data);
      pending.delete(event.data.id);
    }
  });
  Object.defineProperty(window, "desktop", { value: Object.freeze({
    load: () => call("load"),
    save: (raw, expected) => call("save", raw, expected),
    info: () => call("info"),
    exportBackup: () => request("export"),
    importBackup: () => request("import"),
    backupNow: () => request("backup"),
    openData: () => request("open"),
    quit: () => request("quit"),
    onChange: callback => { onChange = callback; },
  }) });
})();
