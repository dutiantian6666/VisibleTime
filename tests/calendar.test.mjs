import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, parseState, activeSession, stopTimer, toggleTask, deleteTask, dailyStats } from "../core.js";
import { saveHistory } from "../history.js";
import { savePlan, deletePlan, startPlan, togglePlan, plansForDay, actualForPlan, monthDates } from "../calendar.js";

const now = new Date(2026, 9, 28, 12).getTime();
const start = new Date(2026, 9, 29, 9, 7).getTime();
const input = { name: "阅读", start, end: start + 12 * 60000, note: "一章书" };

test("minute-level plans accept arbitrary minutes without creating actual time", () => {
  const state = savePlan(emptyState(), input, now);
  assert.equal(state.plans[0].end - state.plans[0].start, 12 * 60000);
  assert.equal(state.sessions.length, 0);
  assert.equal(dailyStats(state, start).total, 0);
  assert.deepEqual(parseState(JSON.stringify(state)), state);
  assert.equal(savePlan(state, { ...input, start: start + 60000 }, now).tasks.length, 1);
});
test("plan validation rejects reversed, fractional-minute and unknown data", () => {
  for (const invalid of [
    { ...input, end: start }, { ...input, start: start + 1000 },
    { ...input, id: "missing" }, { ...input, name: "" }, { ...input, note: "a".repeat(201) },
  ]) assert.throws(() => savePlan(emptyState(), invalid, now));
  const state = savePlan(emptyState(), input, now);
  for (const changed of [{ completed: "yes" }, { taskId: "missing" }, { start: start + 1 }]) {
    assert.throws(() => parseState(JSON.stringify({ ...state, plans: [{ ...state.plans[0], ...changed }] })));
  }
  assert.deepEqual(parseState(JSON.stringify(emptyState())), emptyState());
});
test("starting a plan records the current time and links actual duration", () => {
  let state = savePlan(emptyState(), input, now);
  const id = state.plans[0].id;
  state = startPlan(state, id, now);
  assert.equal(activeSession(state).start, now);
  assert.equal(activeSession(state).planId, id);
  assert.equal(startPlan(state, id, now + 5000), state);
  state = stopTimer(state, now + 92345);
  assert.equal(actualForPlan(state, id), 92345);
  assert.equal(dailyStats(state, now + 92345).total, 92345);
  assert.deepEqual(parseState(JSON.stringify(state)), state);
});
test("plans for the same task get separate linked sessions", () => {
  let state = savePlan(savePlan(emptyState(), input, now), { ...input, start: start + 60000 }, now);
  const [first, second] = state.plans;
  state = startPlan(state, first.id, now);
  state = startPlan(state, second.id, now + 5000);
  assert.equal(state.sessions.length, 2);
  assert.equal(state.sessions[0].end, now + 5000);
  assert.equal(activeSession(state).planId, second.id);
});
test("completing a running plan pauses it, and restarting reopens its task", () => {
  let state = savePlan(emptyState(), input, now);
  const id = state.plans[0].id;
  state = togglePlan(startPlan(state, id, now), id, now + 61000);
  assert.equal(activeSession(state), null);
  assert.equal(state.plans[0].completed, true);
  state = toggleTask(state, state.tasks[0].id, now + 62000);
  state = deleteTask(state, state.tasks[0].id, now + 63000);
  state = startPlan(state, id, now + 64000);
  assert.equal(state.tasks[0].deleted, false);
  assert.equal(state.tasks[0].completed, false);
  assert.equal(state.plans[0].completed, false);
});
test("deleting a plan preserves actual time and detaches its link", () => {
  let state = savePlan(emptyState(), input, now);
  const id = state.plans[0].id;
  state = stopTimer(startPlan(state, id, now), now + 5000);
  state = deletePlan(state, id);
  assert.equal(state.plans.length, 0);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].planId, undefined);
  assert.equal(dailyStats(state, now + 5000).total, 5000);
  assert.deepEqual(parseState(JSON.stringify(state)), state);
});
test("linked actual corrections cannot silently move a plan to another task", () => {
  let state = savePlan(emptyState(), input, now);
  const id = state.plans[0].id;
  state = stopTimer(startPlan(state, id, now - 5000), now);
  assert.throws(() => savePlan(state, { ...input, id, name: "另一事项" }, now));
  state = saveHistory(state, { id: state.sessions[0].id, name: "另一事项", start: now - 5000, end: now }, now);
  assert.equal(state.sessions[0].planId, undefined);
  assert.deepEqual(parseState(JSON.stringify(state)), state);
});
test("month grid starts on Monday and cross-midnight plans clip to local days", () => {
  const dates = monthDates(start);
  assert.equal(dates.length, 42);
  assert.equal(dates[0].getDay(), 1);
  const midnight = new Date(2026, 9, 30).getTime();
  const state = savePlan(emptyState(), { ...input, start: midnight - 60000, end: midnight + 60000 }, now);
  assert.equal(plansForDay(state, start)[0].visibleEnd, midnight);
  assert.equal(plansForDay(state, midnight)[0].visibleStart, midnight);
  assert.equal(plansForDay(state, midnight + 86400000).length, 0);
});
