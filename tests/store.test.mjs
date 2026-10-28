import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, backupEnvelope, decodeBackup } from "../desktop/store.mjs";
import { emptyState, createTask, startTimer, activeSession } from "../core.js";

const now = new Date(2026, 9, 28, 9).getTime();
const fixture = t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "visible-time-store-"));
  const store = new Store(directory, now);
  t.after(() => store.close());
  return store;
};
const sample = () => createTask(emptyState(), "写作", now, "task-a");

test("persists to a real SQLite file and survives reopening", t => {
  const store = fixture(t);
  store.save(sample(), now);
  assert.equal(readFileSync(store.databasePath).subarray(0, 15).toString(), "SQLite format 3");
  store.close();
  const reopened = new Store(store.directory, now + 1000);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.load(), sample());
});

test("invalid writes and stale renderer updates cannot overwrite data", t => {
  const store = fixture(t);
  const original = store.raw();
  store.save(sample(), now);
  assert.throws(() => store.saveRaw(original, original, now));
  assert.throws(() => store.save({ version: 1, tasks: [], sessions: [{}] }));
  assert.deepEqual(store.load(), sample());
});

test("recovery ends an interrupted timer at the last heartbeat", t => {
  const store = fixture(t);
  store.save(startTimer(sample(), "task-a", now, "session-a"), now);
  store.heartbeat(now + 10000);
  store.close();
  const reopened = new Store(store.directory, now + 3600000);
  t.after(() => reopened.close());
  assert.equal(reopened.recovered, true);
  assert.equal(activeSession(reopened.load()), null);
  assert.equal(reopened.load().sessions[0].end, now + 10000);
});

test("pausing on suspend or exit persists the exact stop time", t => {
  const store = fixture(t);
  store.save(startTimer(sample(), "task-a", now, "session-a"), now);
  store.pause(now + 25000);
  assert.equal(store.load().sessions[0].end, now + 25000);
  store.close();
  const reopened = new Store(store.directory, now + 50000);
  t.after(() => reopened.close());
  assert.equal(reopened.recovered, false);
  assert.equal(reopened.load().sessions[0].end, now + 25000);
});

test("export and import preserve records, with a backup before replacement", t => {
  const store = fixture(t);
  store.save(sample(), now);
  const file = path.join(store.directory, "export.json");
  store.exportFile(file, now);
  const previous = createTask(sample(), "阅读", now, "task-b");
  store.save(previous, now);
  const result = store.importFile(file, now + 1000);
  assert.deepEqual(store.load(), sample());
  assert.deepEqual(JSON.parse(readFileSync(result.previousBackup, "utf8")).state, previous);
});

test("running imports end at export time and v1 raw data remains importable", () => {
  const state = startTimer(sample(), "task-a", now, "session-a");
  const imported = decodeBackup(JSON.stringify(backupEnvelope(state, now + 20000)), now + 60000);
  assert.equal(imported.sessions[0].end, now + 20000);
  assert.deepEqual(decodeBackup(JSON.stringify(sample()), now), sample());
  assert.throws(() => decodeBackup('{"format":"visible-time-backup","formatVersion":99}'));
});

test("a malformed import leaves the current database untouched", t => {
  const store = fixture(t);
  store.save(sample(), now);
  const file = path.join(store.directory, "broken.json");
  writeFileSync(file, "{broken");
  const count = readdirSync(store.backupDirectory).length;
  assert.throws(() => store.importFile(file, now));
  assert.deepEqual(store.load(), sample());
  assert.equal(readdirSync(store.backupDirectory).length, count);
});

test("daily backups are idempotent and a corrupt database is not reset", t => {
  const store = fixture(t);
  store.ensureDailyBackup(now);
  assert.equal(readdirSync(store.backupDirectory).filter(name => name.includes("-daily-")).length, 1);
  store.db.prepare("UPDATE app_state SET payload = ? WHERE id = 1").run("{broken");
  store.close();
  assert.throws(() => new Store(store.directory, now));
  assert.ok(readFileSync(store.databasePath).length > 0);
});
