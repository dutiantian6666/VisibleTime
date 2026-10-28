import { createTask, dayBounds, durationText } from "./core.js";

export function localDate(value = Date.now()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localInput(value = Date.now()) {
  const date = new Date(value);
  return `${localDate(value)}T${[date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, "0")).join(":")}`;
}

export function historyForDay(state, date, taskId = "", now = Date.now()) {
  const bounds = dayBounds(date);
  return state.sessions.flatMap(session => {
    const start = Math.max(session.start, bounds.start);
    const end = Math.min(session.end ?? now, bounds.end, now);
    if (end <= start || (taskId && session.taskId !== taskId)) return [];
    return [{
      ...session, visibleStart: start, visibleEnd: end, duration: end - start,
      name: state.tasks.find(task => task.id === session.taskId)?.name ?? "任务",
      crossesDay: session.start < bounds.start || (session.end ?? now) > bounds.end,
    }];
  }).sort((a, b) => b.visibleStart - a.visibleStart);
}

export function saveHistory(state, { id, name, start, end, note = "" }, now = Date.now()) {
  name = name.trim();
  note = note.trim();
  if (!name || name.length > 80 || note.length > 200) throw new Error("事项名称为 1—80 字，备注最多 200 字。");
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > now) {
    throw new Error("结束时间须晚于开始时间，实际记录不能安排在未来。");
  }
  const existing = id ? state.sessions.find(session => session.id === id) : null;
  if (id && !existing) throw new Error("这段记录已不存在，请刷新后重试。");
  if (existing?.end === null) throw new Error("请先暂停正在进行的计时，再修正记录。");
  if (state.sessions.some(session => session.id !== id &&
    session.start < end && (session.end ?? now) > start)) throw new Error("这段时间与已有记录重叠，请核对起止时间。");
  let next = state;
  let task = state.tasks.find(item => item.name === name);
  if (!task) {
    next = createTask(state, name, now);
    task = next.tasks.at(-1);
  }
  const session = existing ? {
    ...existing, taskId: task.id, start, end, note, editedAt: now,
    originalStart: existing.originalStart ?? existing.start,
    originalEnd: existing.originalEnd ?? existing.end,
  } : { id: crypto.randomUUID(), taskId: task.id, start, end, note, source: "manual" };
  if (existing && task.id !== existing.taskId) delete session.planId;
  return { ...next, sessions: existing ? next.sessions.map(item => item.id === id ? session : item) : [...next.sessions, session] };
}

export function deleteHistory(state, id) {
  const session = state.sessions.find(item => item.id === id);
  if (!session || session.end === null) throw new Error("请先暂停计时，再删除记录。");
  return { ...state, sessions: state.sessions.filter(item => item.id !== id) };
}

export function attachHistory({ getState, commit, notify, element }) {
  const $ = selector => document.querySelector(selector);
  let selectedDay = localDate();
  let followToday = true;
  let filter = "";
  let rowsKey = "";
  let tasksKey = "";
  let editId = null;
  const timeText = value => new Date(value).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dayTime = () => new Date(`${selectedDay}T12:00:00`).getTime();

  function render(state, now = Date.now()) {
    if (followToday) selectedDay = localDate(now);
    $("#history-date").value = selectedDay;
    if (tasksKey !== JSON.stringify(state.tasks)) {
      tasksKey = JSON.stringify(state.tasks);
      const options = [new Option("全部事项", "")];
      state.tasks.forEach(task => options.push(new Option(task.name, task.id)));
      $("#history-filter").replaceChildren(...options);
      $("#history-filter").value = filter;
      $("#history-task-names").replaceChildren(...state.tasks.map(task => new Option(task.name, task.name)));
    }
    const entries = historyForDay(state, dayTime(), filter, now);
    $("#history-summary").textContent = `${entries.length} 段记录 · 合计 ${durationText(entries.reduce((sum, entry) => sum + entry.duration, 0))}`;
    $("#history-empty").hidden = entries.length > 0;
    const key = JSON.stringify([state.sessions, state.tasks, selectedDay, filter, entries.map(entry => entry.id)]);
    if (key !== rowsKey) {
      rowsKey = key;
      const fragment = document.createDocumentFragment();
      for (const entry of entries) {
        const row = element("article", "history-row");
        row.dataset.session = entry.id;
        const time = element("div", "history-time");
        const range = element("span", "", `${timeText(entry.visibleStart)}—${timeText(entry.visibleEnd)}`);
        range.dataset.historyRange = entry.id;
        time.append(range);
        time.append(element("span", "history-source", entry.end === null ? "进行中" : entry.source === "manual" ? "手动补录" : "专注计时"));
        const info = element("div", "history-info");
        info.append(element("h3", "", entry.name));
        if (entry.note) info.append(element("p", "", entry.note));
        if (entry.crossesDay) info.append(element("span", "history-tag", "跨日记录 · 本页只计算当天部分"));
        if (entry.editedAt) info.append(element("span", "history-tag", "已修正"));
        const duration = element("strong", "history-duration", durationText(entry.duration));
        duration.dataset.historyDuration = entry.id;
        const actions = element("div", "history-actions");
        for (const [action, label] of [["edit", "修正"], ["delete", "删除"]]) {
          const button = element("button", "", label);
          button.type = "button";
          button.dataset.historyAction = action;
          button.disabled = entry.end === null;
          actions.append(button);
        }
        row.append(time, info, duration, actions);
        fragment.append(row);
      }
      $("#history-list").replaceChildren(fragment);
    }
    for (const entry of entries) {
      const row = [...$("#history-list").children].find(item => item.dataset.session === entry.id);
      if (row) {
        row.querySelector("[data-history-range]").textContent = `${timeText(entry.visibleStart)}—${entry.end === null ? "现在" : timeText(entry.visibleEnd)}`;
        row.querySelector("[data-history-duration]").textContent = durationText(entry.duration);
      }
    }
  }

  function openEditor(id = null) {
    editId = id;
    const entry = getState().sessions.find(item => item.id === id);
    $("#history-editor-title").textContent = entry ? "修正时间记录" : "补录一段时间";
    $("#history-task").value = entry ? getState().tasks.find(task => task.id === entry.taskId).name : "";
    const now = Date.now();
    const end = followToday ? now : Math.min(now, new Date(`${selectedDay}T18:00:00`).getTime());
    $("#history-start").value = localInput(entry?.start ?? end - 30 * 60000);
    $("#history-end").value = localInput(entry?.end ?? end);
    $("#history-note").value = entry?.note ?? "";
    $("#history-editor-error").textContent = "";
    $("#history-editor").showModal();
  }

  $("#history-date").addEventListener("change", event => {
    if (!event.target.value) return;
    selectedDay = event.target.value;
    followToday = selectedDay === localDate();
    render(getState());
  });
  for (const [id, offset] of [["history-prev", -1], ["history-next", 1], ["history-today", 0]]) {
    $(`#${id}`).addEventListener("click", () => {
      const date = offset ? new Date(dayTime()) : new Date();
      if (offset) date.setDate(date.getDate() + offset);
      selectedDay = localDate(date);
      followToday = selectedDay === localDate();
      render(getState());
    });
  }
  $("#history-filter").addEventListener("change", event => { filter = event.target.value; render(getState()); });
  $("#history-add").addEventListener("click", () => openEditor());
  $("#history-list").addEventListener("click", event => {
    const button = event.target.closest("[data-history-action]");
    if (!button) return;
    const id = button.closest("[data-session]").dataset.session;
    if (button.dataset.historyAction === "edit") openEditor(id);
    else if (confirm("删除这段实际记录？对应的累计耗时也会减少，任务仍然保留。")) {
      commit(state => deleteHistory(state, id), "记录已删除，统计已更新。");
    }
  });
  $("#history-editor-close").addEventListener("click", () => $("#history-editor").close());
  $("#history-editor-form").addEventListener("submit", event => {
    event.preventDefault();
    const input = {
      id: editId, name: $("#history-task").value,
      start: new Date($("#history-start").value).getTime(), end: new Date($("#history-end").value).getTime(),
      note: $("#history-note").value,
    };
    try {
      // Validate before commit so a rejected edit does not disable durable storage.
      saveHistory(getState(), input);
      if (commit(state => saveHistory(state, input), "时间记录已保存。")) $("#history-editor").close();
    } catch (error) { $("#history-editor-error").textContent = error.message; }
  });
  return render;
}
