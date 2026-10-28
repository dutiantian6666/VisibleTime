import * as sqlite from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { emptyState, parseState, activeSession, stopTimer } from "../core.js";

const Database = sqlite.DatabaseSync ?? sqlite.Database;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export function backupEnvelope(state, now = Date.now()) {
  return { format: "visible-time-backup", formatVersion: 1, exportedAt: now, state };
}

export function decodeBackup(raw, now = Date.now()) {
  if (Buffer.byteLength(raw, "utf8") > MAX_IMPORT_BYTES) throw new Error("文件过大，最多支持 20 MB。");
  const value = JSON.parse(raw);
  const wrapped = value?.format === "visible-time-backup";
  if (wrapped && (value.formatVersion !== 1 || !Number.isSafeInteger(value.exportedAt) || value.exportedAt < 0)) {
    throw new Error("不支持的备份版本。");
  }
  const state = parseState(JSON.stringify(wrapped ? value.state : value));
  // Imported running sessions end at export time, rather than counting the transfer interval.
  return stopTimer(state, wrapped ? Math.min(value.exportedAt, now) : now);
}

export function writeAtomic(file, contents) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, contents, { flag: "wx", encoding: "utf8" });
  renameSync(temporary, file);
}

export class Store {
  constructor(directory, now = Date.now()) {
    this.directory = directory;
    this.backupDirectory = path.join(directory, "backups");
    mkdirSync(this.backupDirectory, { recursive: true });
    this.databasePath = path.join(directory, "visible-time.db");
    this.db = new Database(this.databasePath);
    try {
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS app_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL,
          heartbeat INTEGER NOT NULL
        );
      `);
      this.db.prepare("INSERT OR IGNORE INTO app_state VALUES (1, ?, ?)").run(JSON.stringify(emptyState()), now);
      const row = this.db.prepare("SELECT payload, heartbeat FROM app_state WHERE id = 1").get();
      const state = parseState(row.payload);
      this.recovered = Boolean(activeSession(state));
      if (this.recovered) this.save(stopTimer(state, Math.min(row.heartbeat, now)), now);
      this.ensureDailyBackup(now);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  load() {
    return parseState(this.db.prepare("SELECT payload FROM app_state WHERE id = 1").get().payload);
  }

  raw() {
    return JSON.stringify(this.load());
  }

  save(state, now = Date.now()) {
    const raw = JSON.stringify(state);
    parseState(raw);
    this.db.prepare("UPDATE app_state SET payload = ?, heartbeat = ? WHERE id = 1").run(raw, now);
    return raw;
  }

  saveRaw(raw, expectedRaw, now = Date.now()) {
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_IMPORT_BYTES) throw new Error("无效的数据大小。");
    if (this.raw() !== expectedRaw) throw new Error("记录已更新，请刷新后重试。");
    return this.save(parseState(raw), now);
  }

  heartbeat(now = Date.now()) {
    this.db.prepare("UPDATE app_state SET heartbeat = ? WHERE id = 1").run(now);
  }

  pause(now = Date.now()) {
    return this.save(stopTimer(this.load(), now), now);
  }

  backup(reason = "manual", now = Date.now()) {
    const stamp = new Date(now).toISOString().replaceAll(":", "-");
    const file = path.join(this.backupDirectory, `${stamp}-${reason}-${randomUUID().slice(0, 8)}.json`);
    writeAtomic(file, JSON.stringify(backupEnvelope(this.load(), now), null, 2));
    return file;
  }

  ensureDailyBackup(now = Date.now()) {
    const date = new Date(now).toISOString().slice(0, 10);
    if (!readdirSync(this.backupDirectory).some(name => name.startsWith(date) && name.includes("-daily-"))) {
      this.backup("daily", now);
    }
  }

  importFile(file, now = Date.now()) {
    const next = decodeBackup(readFileSync(file, "utf8"), now);
    const previousBackup = this.backup("before-import", now);
    this.save(next, now);
    return { state: next, previousBackup };
  }

  exportFile(file, now = Date.now()) {
    writeAtomic(file, JSON.stringify(backupEnvelope(this.load(), now), null, 2));
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
