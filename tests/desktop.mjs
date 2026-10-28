import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { emptyState, createTask, activeSession, startTimer } from "../core.js";
import { Store, backupEnvelope } from "../desktop/store.mjs";

const require = createRequire(import.meta.url);
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const directory = path.join(root, "desktop-test-data", `run-${Date.now()}`);
mkdirSync(directory, { recursive: true });
const env = { ...process.env, VISIBLE_TIME_TEST: "1", VISIBLE_TIME_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.VISIBLE_TIME_EXECUTABLE || require("electron");
const launch = () => _electron.launch({
  executablePath, args: process.env.VISIBLE_TIME_EXECUTABLE ? [] : [root], env, timeout: 30000,
});
let application;
const errors = [];

try {
  application = await launch();
  let page = await application.firstWindow();
  page.on("pageerror", error => errors.push(error.message));
  await page.locator("#task-input").waitFor();
  assert.equal(await page.locator("#storage-warning").isVisible(), false);
  assert.equal(await page.locator("#storage-badge").textContent(), "桌面版 · 本机保存");
  await page.locator("#task-input").fill("验证桌面后台计时");
  await page.locator("#task-input").press("Enter");
  await page.locator('[aria-label="开始计时：验证桌面后台计时"]').click();
  const original = await page.evaluate(() => window.desktop.load());
  assert.ok(activeSession(JSON.parse(original)));
  assert.equal(await page.evaluate(() => localStorage.getItem("visible-time.v1")), null);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  assert.equal(await page.evaluate(() => window.desktop.load()), original);

  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  assert.ok(activeSession(JSON.parse(await page.evaluate(() => window.desktop.load()))));
  await application.evaluate(({ powerMonitor }) => powerMonitor.emit("suspend"));
  assert.equal(activeSession(JSON.parse(await page.evaluate(() => window.desktop.load()))), null);
  await application.evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
  assert.equal(activeSession(JSON.parse(await page.evaluate(() => window.desktop.load()))), null);
  await page.reload();
  assert.equal(await page.locator(".task-row").count(), 1);
  await page.locator('[aria-label="开始计时：验证桌面后台计时"]').click();
  await application.close();
  application = null;
  const persisted = new Store(path.join(directory, "data"));
  assert.equal(activeSession(persisted.load()), null);
  assert.ok(persisted.load().sessions.length >= 2);
  persisted.close();

  application = await launch();
  page = await application.firstWindow();
  page.on("pageerror", error => errors.push(error.message));
  await page.locator(".task-row").waitFor();
  const exportFile = path.join(directory, "export.json");
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportFile);
  await page.locator("#data-settings").click();
  await page.locator("#export-data").click();
  await page.locator("#toast", { hasText: "数据已导出" }).waitFor();
  const exported = JSON.parse(readFileSync(exportFile, "utf8"));
  assert.equal(exported.format, "visible-time-backup");
  assert.equal(exported.state.tasks[0].name, "验证桌面后台计时");
  const importFile = path.join(directory, "import.json");
  const importTime = Date.now();
  const imported = startTimer(createTask(emptyState(), "从网页版迁移的任务", importTime - 10000, "import-task"), "import-task", importTime - 5000, "import-session");
  writeFileSync(importFile, JSON.stringify(backupEnvelope(imported, importTime)));
  await application.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    dialog.showMessageBox = async () => ({ response: 0 });
  }, importFile);
  const beforeCancel = await page.evaluate(() => window.desktop.load());
  await page.locator("#import-data").click();
  await page.waitForFunction(() => !document.querySelector("#import-data").disabled);
  assert.equal(await page.evaluate(() => window.desktop.load()), beforeCancel);
  await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await page.locator("#import-data").click();
  await page.locator("#toast", { hasText: "数据已导入" }).waitFor();
  const afterImport = JSON.parse(await page.evaluate(() => window.desktop.load()));
  assert.equal(afterImport.tasks[0].name, "从网页版迁移的任务");
  assert.equal(afterImport.sessions[0].end, importTime);
  assert.ok(readdirSync(path.join(directory, "data", "backups")).some(name => name.includes("before-import")));
  await page.locator("#backup-data").click();
  await page.locator("#toast", { hasText: "本地备份已创建" }).waitFor();
  assert.ok(readdirSync(path.join(directory, "data", "backups")).some(name => name.includes("manual")));
  await page.locator('[aria-label="关闭数据与备份"]').click();
  mkdirSync(path.join(root, "artifacts"), { recursive: true });
  await page.screenshot({ path: path.join(root, "artifacts", "desktop-v1.1.0.png"), fullPage: true, animations: "disabled" });
  assert.deepEqual(errors, []);
  await application.close();
  application = null;
  console.log("Desktop checks passed: SQLite persistence, browser-data independence, close-to-tray, suspend/resume, exit pause, restart, export, canceled import, confirmed import, pre-import backup, manual backup.");
} finally {
  await application?.close();
}
