import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";
import { emptyState, createTask, startTimer, activeSession } from "../core.js";
import { Store, backupEnvelope } from "../desktop/store.mjs";
import { localInput } from "../history.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const version = JSON.parse(readFileSync(path.join(root, "package.json"))).version;
const executable = process.env.VISIBLE_TIME_EXECUTABLE || path.join(root, "release", `native-${version}`, "VisibleTime.exe");
const directory = path.join(root, "desktop-test-data", `native-${Date.now()}`);
mkdirSync(directory, { recursive: true });
// Create a database with the original Electron store to verify format compatibility.
const legacy = new Store(path.join(directory, "data"));
legacy.save(createTask(emptyState(), "第一版保留的任务", Date.now() - 10000, "legacy"));
legacy.close();
const port = await new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(() => resolve(value)); });
});
const errors = [];
let child;
let browser;
let page;
const test = (action, value = null) => page.evaluate(([action, value]) =>
  JSON.parse(chrome.webview.hostObjects.sync.bridge.Call("test", JSON.stringify([action, value]))).value, [action, value]);
const raw = () => page.evaluate(() => window.desktop.load());
const waitExit = () => new Promise((resolve, reject) => {
  if (child.exitCode !== null) return resolve();
  const timer = setTimeout(() => reject(new Error("Native app did not exit.")), 15000);
  child.once("exit", () => { clearTimeout(timer); resolve(); });
});
async function launch() {
  child = spawn(executable, [], {
    windowsHide: true,
    env: { ...process.env, VISIBLE_TIME_TEST: "1", VISIBLE_TIME_DATA_DIR: directory, VISIBLE_TIME_DEBUG_PORT: String(port) },
    stdio: "ignore",
  });
  child.on("error", error => errors.push(error.message));
  for (let attempt = 0; attempt < 100; attempt++) {
    const errorFile = [path.join(directory, "startup-error.txt"), path.join(directory, "data", "fatal.txt")].find(existsSync);
    if (errorFile) throw new Error(readFileSync(errorFile, "utf8"));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
    if (attempt === 99) throw new Error("WebView2 debug endpoint did not start.");
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages()[0] || await new Promise(resolve => browser.contexts()[0].once("page", resolve));
  page.on("pageerror", error => errors.push(error.message));
  await page.locator("#task-input").waitFor();
}
try {
  await launch();
  assert.equal(await page.locator("#storage-warning").isVisible(), false);
  assert.equal(await page.locator(".task-row").count(), 1);
  assert.equal(await page.locator(".task-name").first().textContent(), "第一版保留的任务");
  await page.locator("#task-input").fill("验证轻量版后台计时");
  await page.locator("#task-input").press("Enter");
  await page.locator('[aria-label="开始计时：验证轻量版后台计时"]').click();
  assert.ok(activeSession(JSON.parse(await raw())));
  const original = await raw();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  assert.equal(await raw(), original);
  await test("hide");
  await page.waitForTimeout(150);
  assert.equal(await test("visible"), false);
  await page.waitForTimeout(5200);
  assert.ok(activeSession(JSON.parse(await raw())));
  const suspendAt = Date.now();
  // Deliver the actual Windows power message through the test bridge.
  await test("suspend");
  await page.waitForFunction(() => !JSON.parse(window.desktop.load()).sessions.some(session => session.end === null));
  const paused = JSON.parse(await raw());
  assert.equal(activeSession(paused), null);
  assert.ok(Math.abs(paused.sessions.at(-1).end - suspendAt) < 2000);
  await test("resume");
  assert.equal(activeSession(JSON.parse(await raw())), null);
  await page.locator('[data-view="calendar"]').click();
  await page.locator("#calendar-add").click();
  await page.locator("#plan-task").fill("验证原生日历计划");
  const planStart = Math.floor(Date.now() / 60000) * 60000 + 86400000;
  await page.locator("#plan-start").fill(localInput(planStart).slice(0, 16));
  await page.locator("#plan-end").fill(localInput(planStart + 12 * 60000).slice(0, 16));
  await page.locator('#plan-editor-form [type="submit"]').click();
  assert.equal(await page.locator("#plan-editor").isVisible(), false);
  assert.equal(JSON.parse(await raw()).plans.length, 1);
  await page.locator('[data-plan-action="start"]').click();
  assert.ok(activeSession(JSON.parse(await raw())).planId);
  await page.locator("#focus-action").click();
  await page.locator('[data-view="history"]').click();
  assert.ok(await page.locator(".history-row").count() >= 1);
  await page.locator('[data-view="focus"]').click();
  await page.locator('[aria-label="开始计时：验证轻量版后台计时"]').click();
  await page.evaluate(() => { void window.desktop.quit(); });
  await waitExit();
  browser = null;
  const stored = new Store(path.join(directory, "data"));
  assert.equal(activeSession(stored.load()), null);
  assert.equal(stored.load().tasks.length, 3);
  assert.equal(stored.load().plans.length, 1);
  stored.close();

  await launch();
  const exportFile = path.join(directory, "export.json");
  const importFile = path.join(directory, "import.json");
  const importAt = Date.now();
  const imported = startTimer(createTask(emptyState(), "迁移的记录", importAt - 10000, "import-task"), "import-task", importAt - 5000, "import-session");
  writeFileSync(importFile, JSON.stringify(backupEnvelope(imported, importAt)));
  await test("dialogs", { exportFile, importFile, confirm: false });
  await page.locator("#data-settings").click();
  await page.locator("#export-data").click();
  await page.locator("#toast", { hasText: "数据已导出" }).waitFor();
  assert.equal(JSON.parse(readFileSync(exportFile)).state.tasks.length, 3);
  assert.equal(JSON.parse(readFileSync(exportFile)).state.plans.length, 1);
  const before = await raw();
  await page.locator("#import-data").click();
  await page.waitForFunction(() => !document.querySelector("#import-data").disabled);
  assert.equal(await raw(), before);
  await test("dialogs", { exportFile, importFile, confirm: true });
  await page.locator("#import-data").click();
  await page.locator("#toast", { hasText: "数据已导入" }).waitFor();
  assert.equal(JSON.parse(await raw()).sessions[0].end, importAt);
  assert.equal(JSON.parse(await raw()).tasks[0].name, "迁移的记录");
  assert.ok(readdirSync(path.join(directory, "data", "backups")).some(name => name.includes("before-import")));
  await page.locator("#backup-data").click();
  await page.locator("#toast", { hasText: "本地备份已创建" }).waitFor();
  await page.locator('[aria-label="关闭数据与备份"]').click();
  await page.screenshot({ path: path.join(root, "artifacts", `native-v${version}.png`), fullPage: true });
  assert.deepEqual(errors, []);
  await page.evaluate(() => { void window.desktop.quit(); });
  await waitExit();
  browser = null;
  console.log("Native WebView2 checks passed: Electron database compatibility, browser-data independence, hidden-window timing, suspend, exit, restart, calendar-linked timing, history, export, canceled/confirmed import, and backups.");
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await waitExit().catch(() => {});
  }
}
