import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyState, parseState, activeSession, createTask, startTimer,
  stopTimer, toggleTask, deleteTask, taskTotals, dailyStats, dayBounds, clockText,
} from "../core.js";

const base = new Date(2026, 9, 28, 9, 0, 0).getTime();
const minute = 60000;
const seed = () => createTask(createTask(emptyState(), "写作", base, "a"), "阅读", base, "b");

test("switching tasks closes the first session at the exact switch time", () => {
  const first = startTimer(seed(), "a", base, "s1");
  const second = startTimer(first, "b", base + 10 * minute, "s2");
  assert.equal(first.sessions[0].end, null);
  assert.equal(second.sessions[0].end, base + 10 * minute);
  assert.equal(activeSession(second).taskId, "b");
  const stats = dailyStats(second, base + 15 * minute);
  assert.equal(stats.byTask.get("a"), 10 * minute);
  assert.equal(stats.byTask.get("b"), 5 * minute);
  assert.equal(stats.total, 15 * minute);
  assert.equal(stats.sessionCount, 2);
});

test("pause freezes elapsed time and resuming accumulates separate sessions", () => {
  let state = startTimer(seed(), "a", base, "s1");
  state = stopTimer(state, base + 5 * minute);
  assert.equal(dailyStats(state, base + 30 * minute).total, 5 * minute);
  state = startTimer(state, "a", base + 30 * minute, "s2");
  assert.equal(dailyStats(state, base + 35 * minute).total, 10 * minute);
  assert.equal(state.sessions.length, 2);
});

test("serialization restores a running timer without losing time", () => {
  const original = startTimer(seed(), "a", base, "s1");
  const restored = parseState(JSON.stringify(original));
  assert.equal(activeSession(restored).start, base);
  assert.equal(dailyStats(restored, base + 90 * minute).total, 90 * minute);
});

test("completion stops the active session and reopening preserves history", () => {
  let state = startTimer(seed(), "a", base, "s1");
  state = toggleTask(state, "a", base + minute + 1);
  assert.equal(activeSession(state), null);
  assert.equal(dailyStats(state, base + 2 * minute).completedCount, 1);
  assert.equal(dailyStats(state, base + 2 * minute).total, minute + 1);
  assert.throws(() => startTimer(state, "a", base + 3 * minute));
  state = toggleTask(state, "a", base + 4 * minute);
  assert.equal(state.tasks[0].completedAt, null);
  assert.equal(dailyStats(state, base + 5 * minute).completedCount, 0);
  assert.equal(state.sessions.length, 1);
});

test("completion requires strictly more than one minute, including previous days and running time", () => {
  let state = startTimer(seed(), "a", base - 86400000, "s1");
  assert.throws(() => toggleTask(seed(), "a", base), /大于 1 分钟/);
  assert.throws(() => toggleTask(state, "a", base - 86400000 + minute - 1));
  assert.throws(() => toggleTask(state, "a", base - 86400000 + minute));
  state = stopTimer(state, base - 86400000 + minute);
  state = startTimer(state, "a", base, "s2");
  assert.equal(taskTotals(state, base + 1).get("a"), minute + 1);
  state = toggleTask(state, "a", base + 1);
  assert.equal(state.tasks[0].completed, true);
  assert.equal(activeSession(state), null);
  // Restoring an older completed task does not require a duration.
  state = { ...state, sessions: [] };
  assert.equal(toggleTask(state, "a", base + 2).tasks[0].completed, false);
});

test("deleting a running task pauses it and preserves history, plans and statistics across serialization", () => {
  let state = startTimer(seed(), "a", base, "s1");
  state.plans = [{ id: "p1", taskId: "a", start: base, end: base + minute, completed: false, createdAt: base }];
  state.sessions[0].planId = "p1";
  state = deleteTask(state, "a", base + minute);
  assert.equal(state.tasks[0].deleted, true);
  assert.equal(activeSession(state), null);
  assert.equal(state.sessions[0].planId, "p1");
  assert.equal(state.plans.length, 1);
  assert.equal(dailyStats(state, base + minute).total, minute);
  assert.deepEqual(parseState(JSON.stringify(state)), state);
  assert.throws(() => startTimer(state, "a", base + 2 * minute));
  assert.throws(() => toggleTask(state, "a", base + 2 * minute));
  assert.throws(() => parseState(JSON.stringify({ ...state, tasks: [{ ...state.tasks[0], deleted: "yes" }] })));
});

test("cross-midnight sessions contribute only their local-day intersection", () => {
  const yesterday = new Date(2026, 9, 27, 23, 50).getTime();
  const today = new Date(2026, 9, 28, 0, 20).getTime();
  let state = startTimer(seed(), "a", yesterday, "s1");
  assert.equal(dailyStats(state, today).total, 20 * minute);
  assert.equal(dailyStats(state, new Date(2026, 9, 27, 23, 59).getTime()).total, 9 * minute);
  state = stopTimer(state, today);
  assert.equal(dailyStats(state, base).total, 20 * minute);
  assert.equal(dailyStats(state, new Date(2026, 9, 29, 12).getTime()).total, 0);
});

test("a session that ends at midnight does not count in the next day", () => {
  const midnight = dayBounds(base).start;
  const state = stopTimer(startTimer(seed(), "a", midnight - minute, "s1"), midnight);
  assert.equal(dailyStats(state, base).total, 0);
  assert.equal(dailyStats(state, base).sessionCount, 0);
});

test("day bounds follow calendar midnights, including daylight-saving changes", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const spring = dayBounds(new Date(2026, 2, 8, 12).getTime());
    const fall = dayBounds(new Date(2026, 10, 1, 12).getTime());
    assert.equal(spring.end - spring.start, 23 * 60 * minute);
    assert.equal(fall.end - fall.start, 25 * 60 * minute);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("invalid and contradictory saved records are rejected", () => {
  assert.deepEqual(parseState(null), emptyState());
  for (const raw of ["{", "null", "{}", '{"version":2,"tasks":[],"sessions":[]}']) {
    assert.throws(() => parseState(raw));
  }
  const duplicate = seed();
  duplicate.tasks[1].id = "a";
  assert.throws(() => parseState(JSON.stringify(duplicate)));
  const multiple = startTimer(seed(), "a", base, "s1");
  multiple.sessions.push({ id: "s2", taskId: "b", start: base, end: null });
  assert.throws(() => parseState(JSON.stringify(multiple)));
  const orphan = { ...seed(), sessions: [{ id: "s1", taskId: "missing", start: base, end: null }] };
  assert.throws(() => parseState(JSON.stringify(orphan)));
});

test("double-start is idempotent and backwards clock changes never create negative durations", () => {
  const state = startTimer(seed(), "a", base, "s1");
  assert.equal(startTimer(state, "a", base + minute, "s2"), state);
  assert.equal(stopTimer(state, base - minute).sessions[0].end, base);
  assert.equal(dailyStats(state, base - minute).total, 0);
  assert.equal(clockText(-1000), "00:00:00");
  assert.equal(clockText(100 * 3600000 + 61000), "100:01:01");
});

test("task names are trimmed and empty or overlong names are rejected", () => {
  assert.equal(createTask(emptyState(), "  写作  ", base, "a").tasks[0].name, "写作");
  assert.throws(() => createTask(emptyState(), "   ", base, "a"));
  assert.throws(() => createTask(emptyState(), "a".repeat(81), base, "a"));
});
