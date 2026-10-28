import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const baseURL = process.env.TEST_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const output = new URL("../artifacts/", import.meta.url);
await mkdir(output, { recursive: true });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, timezoneId: "Asia/Shanghai" });
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
const storageKey = "visible-time.v1";
const getState = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
const addTask = async name => {
  await page.locator("#task-input").fill(name);
  await page.locator("#task-input").press("Enter");
};

try {
  await page.clock.install({ time: new Date("2026-10-28T09:00:00+08:00") });
  await page.goto(baseURL);
  await page.locator("#task-empty").waitFor({ state: "visible" });
  assert.equal(await page.title(), "VisibleTime · 看见时间");
  await page.screenshot({ path: fileURLToPath(new URL("desktop-empty.png", output)), fullPage: true, animations: "disabled" });

  await addTask("完成时间管理工具初版");
  await addTask("读完一章书");
  await addTask("<img src=x onerror=alert(1)>");
  assert.equal(await page.locator(".task-row").count(), 3);
  assert.equal(await page.locator(".task-row img").count(), 0);
  await page.locator('[aria-label="完成任务：<img src=x onerror=alert(1)>"]').click();
  await page.locator('[aria-label="开始计时：完成时间管理工具初版"]').click();
  await page.clock.fastForward(65000);
  assert.equal(await page.locator("#timer").textContent(), "00:01:05");
  await page.reload();
  assert.match(await page.locator("#focus-task").textContent(), /完成时间管理工具初版/);
  assert.equal(await page.locator("#timer").textContent(), "00:01:05");

  await page.locator('[aria-label="开始计时：读完一章书"]').click();
  let saved = await getState();
  assert.equal(saved.sessions.length, 2);
  assert.ok(saved.sessions[0].end !== null);
  assert.equal(saved.sessions.filter(session => session.end === null).length, 1);
  await page.clock.fastForward(35000);
  await page.locator("#focus-action").click();
  saved = await getState();
  assert.ok(saved.sessions.every(session => session.end !== null));
  const pausedTotal = await page.locator("#daily-caption").textContent();
  await page.clock.fastForward(10000);
  assert.equal(await page.locator("#daily-caption").textContent(), pausedTotal);
  await page.locator('[aria-label="开始计时：读完一章书"]').click();
  await page.clock.fastForward(25000);
  await page.locator('[aria-label="完成任务：读完一章书"]').click();
  assert.equal(await page.locator("#done-today").textContent(), "2");
  assert.equal((await getState()).sessions.filter(session => session.end === null).length, 0);
  await page.locator('[data-filter="completed"]').click();
  assert.equal(await page.locator(".task-row").count(), 2);
  assert.equal(await page.locator(".task-row", { hasText: "读完一章书" }).locator(".task-time").textContent(), "00:01:00");
  await page.locator('[aria-label="恢复任务：读完一章书"]').click();
  assert.equal(await page.locator("#done-today").textContent(), "1");
  await page.locator('[data-filter="pending"]').click();
  assert.equal(await page.locator(".task-row").count(), 2);

  const second = await context.newPage();
  await second.goto(baseURL);
  await addTask("整理明天的思路");
  await second.locator(".task-name", { hasText: "整理明天的思路" }).waitFor();
  assert.equal(await second.locator(".task-row").count(), 3);
  await second.close();

  await page.locator('[aria-label="开始计时：完成时间管理工具初版"]').click();
  await page.clock.fastForward(24 * 60000);
  await page.screenshot({ path: fileURLToPath(new URL("desktop-active.png", output)), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: fileURLToPath(new URL("mobile-active.png", output)), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.locator("#focus-action").click();

  const beforeFailure = await getState();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage unavailable", "QuotaExceededError"); };
  });
  await addTask("不应该保存的任务");
  assert.match(await page.locator("#storage-warning").textContent(), /保存未成功/);
  assert.deepEqual(await getState(), beforeFailure);
  assert.equal(await page.locator("#add-task").isDisabled(), true);
  await page.reload();
  assert.equal(await page.locator("#storage-warning").isVisible(), false);

  await page.evaluate(key => localStorage.setItem(key, "{broken"), storageKey);
  await page.reload();
  assert.equal(await page.locator("#storage-warning").isVisible(), true);
  assert.equal(await page.locator("#add-task").isDisabled(), true);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), "{broken");
  assert.deepEqual(errors, []);
  console.log("Browser checks passed: task creation, safe text rendering, timer, reload, switching, pause/resume, completion/reopening, tab sync, mobile layouts, storage failure, corrupt-data protection.");
  console.log("Screenshots saved in artifacts/.");
} finally {
  await context.close();
  await browser.close();
}
