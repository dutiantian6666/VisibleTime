import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, parseState, dailyStats, startTimer } from "../core.js";
import { saveHistory, deleteHistory, historyForDay, localDate, localInput, minuteDuration, timelineInterval, layoutTimeline } from "../history.js";

const now = new Date(2026, 9, 28, 14).getTime();
const start = new Date(2026, 9, 28, 9, 7, 23).getTime();
const end = new Date(2026, 9, 28, 9, 19, 41).getTime();
const input = { name: "阅读", start, end, note: "一章书" };

test("manual entries preserve exact seconds and create or reuse tasks", () => {
  let state = saveHistory(emptyState(), input, now);
  state = saveHistory(state, { ...input, start: end, end: end + 60000 }, now);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.sessions[0].source, "manual");
  assert.equal(dailyStats(state, now).total, end - start + 60000);
  assert.deepEqual(parseState(JSON.stringify(state)), state);
});

test("timeline shrinks on empty days, scales uniformly, and keeps dense cards separate with exact origins", () => {
  const empty = layoutTimeline([], []);
  const sparseIntervals = [{ top: 540, height: 60 }, { top: 720, height: 60 }];
  const sparse = layoutTimeline(sparseIntervals, [57, 57]);
  const dense = layoutTimeline([{ top: 540, height: 1 }, { top: 541, height: 1 }], [57, 57]);
  assert.ok(empty.axisHeight < sparse.axisHeight);
  assert.ok(sparse.axisHeight < dense.axisHeight);
  assert.ok(dense.cards[1].cardTop >= dense.cards[0].cardTop + 57 + 8);
  const zoomed = layoutTimeline(sparseIntervals, [57, 57], 2);
  assert.equal(zoomed.axisHeight, sparse.axisHeight * 2);
  for (const [index, card] of sparse.cards.entries()) {
    assert.ok(Math.abs(zoomed.cards[index].origin - card.origin * 2) < 1e-9);
    assert.ok(Math.abs(card.top / sparse.axisHeight - sparseIntervals[index].top / 1440) < 1e-9);
    assert.ok(Math.abs(card.cardCenter - card.origin) < 1e-9);
  }
  assert.equal(dense.cards[1].origin, (541.5 / 1440) * dense.axisHeight);
  assert.ok(dense.cards[1].cardCenter > dense.cards[1].origin);
});

test("edits update statistics and retain the first original interval", () => {
  let state = saveHistory(emptyState(), input, now);
  const id = state.sessions[0].id;
  state = saveHistory(state, { ...input, id, end: end + 10000 }, now);
  state = saveHistory(state, { ...input, id, end: end + 20000 }, now);
  assert.equal(state.sessions[0].originalEnd, end);
  assert.equal(state.sessions[0].editedAt, now);
  assert.equal(dailyStats(state, now).total, end - start + 20000);
});

test("overlaps, future times, and reversed intervals are rejected", () => {
  const state = saveHistory(emptyState(), input, now);
  assert.throws(() => saveHistory(state, { ...input, start: start + 1 }, now), /重叠/);
  assert.throws(() => saveHistory(state, { ...input, start: now, end: now + 1000 }, now));
  assert.throws(() => saveHistory(state, { ...input, end: start }, now));
  const active = startTimer(state, state.tasks[0].id, end, "active");
  assert.throws(() => saveHistory(active, { ...input, start: end, end: now }, now), /重叠/);
});

test("active sessions cannot be edited or deleted", () => {
  const state = saveHistory(emptyState(), input, now);
  const active = startTimer(state, state.tasks[0].id, end, "active");
  assert.throws(() => saveHistory(active, { ...input, id: "active" }, now), /暂停/);
  assert.throws(() => deleteHistory(active, "active"));
});

test("history clips midnight intersections and filters by task", () => {
  const yesterday = new Date(2026, 9, 27, 23, 50).getTime();
  const today = new Date(2026, 9, 28, 0, 20).getTime();
  const state = saveHistory(emptyState(), { ...input, start: yesterday, end: today }, now);
  const rows = historyForDay(state, now, "", now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].duration, 20 * 60000);
  assert.equal(rows[0].crossesDay, true);
  assert.equal(historyForDay(state, now, "other", now).length, 0);
  assert.equal(historyForDay(state, new Date(2026, 9, 29, 12).getTime(), "", now).length, 0);
});

test("deleting a record keeps the task and updates totals", () => {
  const state = saveHistory(emptyState(), input, now);
  const next = deleteHistory(state, state.sessions[0].id);
  assert.equal(next.tasks.length, 1);
  assert.equal(next.sessions.length, 0);
  assert.equal(dailyStats(next, now).total, 0);
});

test("minute inputs and labels omit seconds while timeline positions reflect wall clock minutes", () => {
  assert.equal(localDate(start), "2026-10-28");
  assert.equal(localInput(start), "2026-10-28T09:07");
  assert.equal(minuteDuration(end - start), "12 分钟");
  assert.equal(minuteDuration(1000), "不足 1 分钟");
  assert.equal(minuteDuration(0), "0 分钟");
  assert.equal(minuteDuration(3660000), "1 小时 1 分钟");
  assert.deepEqual(timelineInterval({ visibleStart: start, visibleEnd: end }, now), { top: 547, height: 12 });
  assert.deepEqual(timelineInterval({ visibleStart: start, visibleEnd: start + 60000 }, now), { top: 547, height: 1 });
  const midnight = new Date(2026, 9, 29).getTime();
  assert.deepEqual(timelineInterval({ visibleStart: midnight - 60000, visibleEnd: midnight }, now), { top: 1439, height: 1 });
});
