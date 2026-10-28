export const STORAGE_KEY = "visible-time.v1";

export function emptyState() {
  return { version: 1, tasks: [], sessions: [] };
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
}

export function parseState(raw) {
  if (raw === null) return emptyState();
  const state = JSON.parse(raw);
  if (!state || state.version !== 1 || !Array.isArray(state.tasks) || !Array.isArray(state.sessions)) {
    throw new Error("Unrecognized saved data");
  }
  const taskIds = new Set();
  for (const task of state.tasks) {
    if (!task || typeof task.id !== "string" || !task.id || taskIds.has(task.id) ||
        typeof task.name !== "string" || !task.name.trim() || task.name.length > 80 ||
        typeof task.completed !== "boolean" || !isTimestamp(task.createdAt) ||
        !(task.completedAt === null || isTimestamp(task.completedAt)) ||
        task.completed !== (task.completedAt !== null)) {
      throw new Error("Invalid task");
    }
    taskIds.add(task.id);
  }
  const sessionIds = new Set();
  let running = 0;
  for (const session of state.sessions) {
    if (!session || typeof session.id !== "string" || !session.id || sessionIds.has(session.id) ||
        !taskIds.has(session.taskId) || !isTimestamp(session.start) ||
        !(session.end === null || (isTimestamp(session.end) && session.end >= session.start)) ||
        !(session.source === undefined || ["timer", "manual"].includes(session.source)) ||
        !(session.note === undefined || (typeof session.note === "string" && session.note.length <= 200)) ||
        !(session.editedAt === undefined || isTimestamp(session.editedAt)) ||
        !(session.originalStart === undefined || isTimestamp(session.originalStart)) ||
        !(session.originalEnd === undefined || isTimestamp(session.originalEnd))) {
      throw new Error("Invalid session");
    }
    if (session.end === null) {
      running += 1;
      if (state.tasks.find(task => task.id === session.taskId).completed) throw new Error("Completed active task");
    }
    sessionIds.add(session.id);
  }
  if (running > 1) throw new Error("Multiple active sessions");
  return state;
}

export function activeSession(state) {
  return state.sessions.find(session => session.end === null) ?? null;
}

export function createTask(state, name, now = Date.now(), id = crypto.randomUUID()) {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 80) throw new Error("Invalid task name");
  return {
    ...state,
    tasks: [...state.tasks, { id, name: cleanName, completed: false, createdAt: now, completedAt: null }],
  };
}

export function stopTimer(state, now = Date.now()) {
  return {
    ...state,
    sessions: state.sessions.map(session =>
      session.end === null ? { ...session, end: Math.max(session.start, now) } : session),
  };
}

export function startTimer(state, taskId, now = Date.now(), id = crypto.randomUUID()) {
  const task = state.tasks.find(item => item.id === taskId);
  if (!task || task.completed) throw new Error("Task unavailable");
  if (activeSession(state)?.taskId === taskId) return state;
  const stopped = stopTimer(state, now);
  return { ...stopped, sessions: [...stopped.sessions, { id, taskId, start: now, end: null }] };
}

export function toggleTask(state, taskId, now = Date.now()) {
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new Error("Task unavailable");
  const next = activeSession(state)?.taskId === taskId ? stopTimer(state, now) : state;
  return {
    ...next,
    tasks: next.tasks.map(item => item.id === taskId ?
      { ...item, completed: !item.completed, completedAt: item.completed ? null : now } : item),
  };
}

export function dayBounds(now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

export function dailyStats(state, now = Date.now()) {
  const bounds = dayBounds(now);
  const byTask = new Map();
  let sessionCount = 0;
  for (const session of state.sessions) {
    const end = Math.min(session.end ?? now, now, bounds.end);
    const start = Math.max(session.start, bounds.start);
    const elapsed = Math.max(0, end - start);
    if (elapsed > 0) {
      byTask.set(session.taskId, (byTask.get(session.taskId) ?? 0) + elapsed);
      sessionCount += 1;
    }
  }
  return {
    byTask,
    total: [...byTask.values()].reduce((sum, value) => sum + value, 0),
    sessionCount,
    completedCount: state.tasks.filter(task => task.completed &&
      task.completedAt >= bounds.start && task.completedAt < bounds.end).length,
  };
}

export function clockText(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
}

export function durationText(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} 分 ${seconds % 60} 秒` :
    `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分`;
}
