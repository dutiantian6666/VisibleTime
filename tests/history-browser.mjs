import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, timezoneId: "Asia/Shanghai" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.clock.install({ time: new Date("2026-10-28T14:00:00+08:00") });
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:4174");
  await page.locator('[data-view="history"]').click();
  const axisHeight = () => page.locator(".history-axis").evaluate(node => node.getBoundingClientRect().height);
  const emptyHeight = await axisHeight();
  assert.ok(emptyHeight <= 180);
  await page.locator("#history-add").click();
  await page.locator("#history-task").fill("阅读与思考");
  await page.locator("#history-start").fill("2026-10-28T09:07");
  await page.locator("#history-end").fill("2026-10-28T09:19");
  await page.locator("#history-note").fill("读完一章，留一点时间整理笔记。");
  await page.locator('#history-editor-form [type="submit"]').click();
  assert.equal(await page.locator(".history-row").count(), 1);
  await page.waitForFunction(() => document.querySelector("#toast").parentElement === document.body);
  assert.equal(await page.locator("#toast").evaluate(node => node.matches(":popover-open")), true);
  assert.match(await page.locator("#history-summary").textContent(), /12 分钟/);
  assert.ok(await axisHeight() > emptyHeight);
  const segment = await page.locator(".history-segment").evaluate(node => ({ top: parseFloat(node.style.top), height: parseFloat(node.style.height) }));
  assert.ok(Math.abs(segment.top / await axisHeight() - 547 / 1440) < .00001);
  assert.ok(Math.abs(segment.height / await axisHeight() - 12 / 1440) < .00001);
  assert.match(await page.locator("[data-history-range]").textContent(), /^09:07—09:19$/);
  assert.equal(await page.locator("#history-start").getAttribute("step"), "60");
  await page.locator('[data-history-action="edit"]').click();
  await page.locator("#history-end").fill("2026-10-28T09:21");
  await page.locator('#history-editor-form [type="submit"]').click();
  assert.match(await page.locator(".history-tag").textContent(), /已修正/);
  await page.locator("#history-add").click();
  await page.locator("#history-task").fill("重叠的时间");
  await page.locator("#history-start").fill("2026-10-28T09:20");
  await page.locator("#history-end").fill("2026-10-28T10:00");
  await page.locator('#history-editor-form [type="submit"]').click();
  assert.match(await page.locator("#history-editor-error").textContent(), /重叠/);
  assert.equal(await page.locator("#storage-warning").isVisible(), false);
  await page.locator("#history-task").fill("专注开发");
  await page.locator("#history-start").fill("2026-10-28T10:00");
  await page.locator("#history-end").fill("2026-10-28T10:30");
  await page.locator('#history-editor-form [type="submit"]').click();
  assert.equal(await page.locator(".history-row").count(), 2);
  await page.locator("#history-prev").click();
  assert.equal(await page.locator(".history-row").count(), 0);
  await page.locator("#history-today").click();
  assert.equal(await page.locator(".history-row").count(), 2);
  await page.reload();
  await page.locator('[data-view="history"]').click();
  assert.equal(await page.locator(".history-row").count(), 2);
  await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
  const assertLayout = async () => {
    const boxes = await page.locator(".history-row").evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }));
    for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].top >= boxes[i - 1].bottom + 7);
    assert.ok(boxes.every(box => box.bottom - box.top <= 60));
    assert.equal(await page.locator(".history-connectors circle").count(), boxes.length);
  };
  await assertLayout();
  assert.equal(await page.locator(".history-tick").last().textContent(), "24:00");
  const automaticHeight = await axisHeight();
  await page.locator("#history-zoom-in").click();
  assert.ok(Math.abs(await axisHeight() - automaticHeight * 1.5) < 1);
  await page.locator("#history-zoom-out").click();
  assert.ok(Math.abs(await axisHeight() - automaticHeight) < 1);
  await page.locator("#history-zoom-auto").click();
  await page.screenshot({ path: fileURLToPath(new URL("../artifacts/history-v1.4.1.png", import.meta.url)), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await assertLayout();
  await page.screenshot({ path: fileURLToPath(new URL("../artifacts/history-mobile-v1.4.1.png", import.meta.url)), fullPage: true, animations: "disabled" });
  page.once("dialog", dialog => dialog.accept());
  await page.locator('[data-history-action="delete"]').first().click();
  assert.equal(await page.locator(".history-row").count(), 1);
  assert.deepEqual(errors, []);
  // Older second-level records remain exact when only their note is changed.
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("visible-time.v1"));
    state.sessions[0].start += 23000;
    state.sessions[0].end += 41000;
    localStorage.setItem("visible-time.v1", JSON.stringify(state));
  });
  await page.reload();
  await page.locator('[data-view="history"]').click();
  const beforeNote = await page.evaluate(() => JSON.parse(localStorage.getItem("visible-time.v1")).sessions[0]);
  await page.locator('[data-history-action="edit"]').click();
  await page.locator("#history-note").fill("仅修改备注，保留原有秒数");
  await page.locator('#history-editor-form [type="submit"]').click();
  const afterNote = await page.evaluate(() => JSON.parse(localStorage.getItem("visible-time.v1")).sessions[0]);
  assert.equal(afterNote.start, beforeNote.start);
  assert.equal(afterNote.end, beforeNote.end);
  await page.clock.pauseAt(new Date("2026-10-28T14:10:23+08:00"));
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("visible-time.v1"));
    state.sessions.push({ id: "minute-rollover", taskId: state.tasks[0].id, start: Date.now(), end: null });
    localStorage.setItem("visible-time.v1", JSON.stringify(state));
  });
  await page.reload();
  await page.locator('[data-view="history"]').click();
  await page.clock.fastForward(37000);
  assert.equal(await page.locator('[data-session="minute-rollover"] .history-duration').textContent(), "不足 1 分钟");
  await page.clock.fastForward(24000);
  assert.equal(await page.locator('[data-session="minute-rollover"] .history-duration').textContent(), "1 分钟");
  // Densely packed minute records keep their true origin and readable two-line cards.
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("visible-time.v1"));
    state.sessions = Array.from({ length: 12 }, (_, index) => ({
      id: `dense-${index}`, taskId: state.tasks[0].id,
      start: new Date(2026, 9, 28, 9, index).getTime(), end: new Date(2026, 9, 28, 9, index + 1).getTime(),
      note: "用于检查两行显示的长备注。".repeat(10), source: "manual",
    }));
    localStorage.setItem("visible-time.v1", JSON.stringify(state));
  });
  await page.reload();
  await page.locator('[data-view="history"]').click();
  await assertLayout();
  assert.ok(await axisHeight() > automaticHeight);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator(".history-row").first().getAttribute("title").then(text => text.includes("长备注")), true);
  const lineAccuracy = await page.locator("#history-list").evaluate(list => {
    const height = list.querySelector(".history-axis").getBoundingClientRect().height;
    const rows = new Map([...list.querySelectorAll(".history-row")].map(row => [row.dataset.session, row]));
    return [...list.querySelectorAll("[data-connector]")].every(group => {
      const index = Number(group.dataset.connector.split("-")[1]);
      const dot = group.querySelector("circle");
      const row = rows.get(group.dataset.connector);
      return Math.abs(Number(dot.getAttribute("cy")) - (540 + index + .5) / 1440 * height) < .01 &&
        group.querySelector("path").getAttribute("d").endsWith(`${row.offsetLeft} ${parseFloat(row.style.top) + row.offsetHeight / 2}`);
    });
  });
  assert.equal(lineAccuracy, true);
  await page.locator(".history-row").first().hover();
  assert.equal(await page.locator('.history-connectors .is-highlighted').getAttribute("data-connector"), "dense-0");
  assert.equal(await page.locator('.history-connectors g').last().getAttribute("data-connector"), "dense-0");
  await page.screenshot({ path: fileURLToPath(new URL("../artifacts/history-dense-mobile-v1.4.1.png", import.meta.url)), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1360, height: 1000 });
  await assertLayout();
  await page.screenshot({ path: fileURLToPath(new URL("../artifacts/history-dense-v1.4.1.png", import.meta.url)), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 320, height: 740 });
  await assertLayout();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log("History UI checks passed: minute precision, proportional day axis, non-overlapping cards, legacy second preservation, manual entry, correction, overlap rejection, navigation, reload, mobile layout, and deletion.");
} finally { await context.close(); await browser.close(); }
