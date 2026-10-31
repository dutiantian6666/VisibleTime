import { createTask, dayBounds } from "./core.js";

export function localDate(value = Date.now()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localInput(value = Date.now()) {
  const date = new Date(value);
  return `${localDate(value)}T${[date.getHours(), date.getMinutes()].map(n => String(n).padStart(2, "0")).join(":")}`;
}

export function minuteDuration(milliseconds) {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60000);
  if (minutes < 1) return milliseconds > 0 ? "不足 1 分钟" : "0 分钟";
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export function timelineInterval(entry, date) {
  const bounds = dayBounds(date);
  const position = value => value >= bounds.end ? 1440 : new Date(value).getHours() * 60 + new Date(value).getMinutes();
  const top = position(entry.visibleStart);
  return { top, height: Math.min(1440 - top, Math.max(1, position(entry.visibleEnd) - top)) };
}

export function layoutTimeline(intervals, cardHeights, zoom = 1) {
  let autoHeight = intervals.length ? 480 : 160;
  for (let index = 1; index < intervals.length; index++) {
    const gap = intervals[index].top - intervals[index - 1].top;
    const spacing = (cardHeights[index - 1] + cardHeights[index]) / 2 + 8;
    autoHeight = Math.max(autoHeight, gap > 0 ? spacing * 1440 / gap : 2880);
  }
  // Very dense cards use individual connectors instead of an unbounded day axis.
  const axisHeight = Math.round(Math.min(autoHeight, 2880) * zoom);
  const scale = axisHeight / 1440;
  let bottom = 0;
  const cards = intervals.map((interval, index) => {
    const top = interval.top * scale;
    const height = Math.min(axisHeight - top, Math.max(1, interval.height * scale));
    const origin = top + height / 2;
    const cardTop = Math.max(0, origin - cardHeights[index] / 2, index ? bottom + 8 : 0);
    bottom = cardTop + cardHeights[index];
    return { top, height, origin, cardTop, cardCenter: cardTop + cardHeights[index] / 2 };
  });
  return { axisHeight, height: Math.max(axisHeight, bottom), cards };
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
  let task = state.tasks.find(item => item.name === name && (!item.deleted || item.id === existing?.taskId));
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
  let layoutKey = "";
  let tasksKey = "";
  let editId = null;
  let zoom = 1;
  const colors = ["#527c59", "#4d7f99", "#a17845", "#83709d", "#9d6670", "#4c8982"];
  const svgElement = (tag, attributes) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  };
  const timeText = value => new Date(value).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
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
      $("#history-task-names").replaceChildren(...state.tasks.filter(task => !task.deleted).map(task => new Option(task.name, task.name)));
    }
    if ($("#history-view").hidden) return;
    const entries = historyForDay(state, dayTime(), filter, now).reverse();
    $("#history-summary").textContent = `${entries.length} 段记录 · 合计 ${minuteDuration(entries.reduce((sum, entry) => sum + entry.duration, 0))}`;
    $("#history-empty").hidden = entries.length > 0;
    const key = JSON.stringify([state.sessions, state.tasks, selectedDay, filter, entries.map(entry => entry.id)]);
    if (key !== rowsKey) {
      rowsKey = key;
      const fragment = document.createDocumentFragment();
      const axis = element("div", "history-axis");
      axis.setAttribute("aria-hidden", "true");
      const connectors = svgElement("svg", { class: "history-connectors", "aria-hidden": "true" });
      fragment.append(axis, connectors);
      for (const [index, entry] of entries.entries()) {
        const color = colors[index % colors.length];
        const segment = element("div", `history-segment${entry.end === null ? " is-running" : ""}`);
        segment.style.background = color;
        segment.dataset.segment = entry.id;
        segment.title = `${entry.name} · ${timeText(entry.visibleStart)}—${entry.visibleEnd === dayBounds(dayTime()).end ? "24:00" : timeText(entry.visibleEnd)}`;
        segment.setAttribute("aria-hidden", "true");
        const connector = svgElement("g", { "data-connector": entry.id, stroke: color });
        connector.append(svgElement("path", { fill: "none", "stroke-width": 1.5 }),
          svgElement("circle", { r: 3.5, fill: color, stroke: "var(--paper)", "stroke-width": 1 }));
        connectors.append(connector);
        const row = element("article", "history-row");
        row.style.setProperty("--record-color", color);
        row.dataset.session = entry.id;
        row.title = [entry.name, entry.note, entry.crossesDay ? "跨日记录 · 本页只计算当天部分" : "", entry.editedAt ? "已修正" : ""].filter(Boolean).join("\n");
        const time = element("div", "history-time");
        const range = element("span", "", `${timeText(entry.visibleStart)}—${timeText(entry.visibleEnd)}`);
        range.dataset.historyRange = entry.id;
        time.append(range);
        const info = element("div", "history-info");
        info.append(element("h3", "", entry.name));
        info.append(element("span", `history-source${entry.end === null ? " is-running" : ""}`, entry.end === null ? "进行中" : entry.source === "manual" ? "手动补录" : "专注计时"));
        if (entry.crossesDay) info.append(element("span", "history-tag", "跨日"));
        if (entry.editedAt) info.append(element("span", "history-tag", "已修正"));
        if (entry.note) {
          const note = element("span", "history-note", entry.note);
          note.title = entry.note;
          info.append(note);
        }
        const duration = element("strong", "history-duration", minuteDuration(entry.duration));
        duration.dataset.historyDuration = entry.id;
        time.append(duration);
        const actions = element("div", "history-actions");
        for (const [action, label] of [["edit", "修正"], ["delete", "删除"]]) {
          const button = element("button", "", action === "edit" ? "✎" : "×");
          button.type = "button";
          button.dataset.historyAction = action;
          button.title = `${label}记录`;
          button.setAttribute("aria-label", `${label}记录：${entry.name}`);
          button.disabled = entry.end === null;
          actions.append(button);
        }
        row.append(time, info, actions);
        fragment.append(segment, row);
      }
      $("#history-list").replaceChildren(fragment);
    }
    const nextLayout = JSON.stringify([key, zoom, $("#history-list").clientWidth,
      entries.map(entry => [Math.floor(entry.visibleEnd / 60000), Math.floor(entry.duration / 60000)])]);
    if (layoutKey === nextLayout) return;
    layoutKey = nextLayout;
    const rows = new Map([...$("#history-list").querySelectorAll("[data-session]")].map(node => [node.dataset.session, node]));
    const segments = new Map([...$("#history-list").querySelectorAll("[data-segment]")].map(node => [node.dataset.segment, node]));
    const connectors = new Map([...$("#history-list").querySelectorAll("[data-connector]")].map(node => [node.dataset.connector, node]));
    const layout = layoutTimeline(entries.map(entry => timelineInterval(entry, dayTime())),
      entries.map(entry => rows.get(entry.id).offsetHeight), zoom);
    const axis = $("#history-list .history-axis");
    axis.style.height = `${layout.axisHeight}px`;
    axis.replaceChildren();
    const tickStep = layout.axisHeight < 360 ? 12 : layout.axisHeight < 720 ? 6 : layout.axisHeight < 1440 ? 3 : 2;
    for (let hour = 0; hour <= 24; hour += tickStep) {
      const tick = element("span", "history-tick", `${String(hour).padStart(2, "0")}:00`);
      tick.style.top = `${hour / 24 * layout.axisHeight}px`;
      axis.append(tick);
    }
    const svg = $("#history-list .history-connectors");
    const width = $("#history-list").clientWidth;
    svg.setAttribute("viewBox", `0 0 ${width} ${layout.height}`);
    const axisX = axis.offsetLeft + 1;
    for (const [index, entry] of entries.entries()) {
      const row = rows.get(entry.id);
      if (row) {
        row.querySelector("[data-history-range]").textContent = `${timeText(entry.visibleStart)}—${entry.end === null ? "现在" : entry.visibleEnd === dayBounds(dayTime()).end ? "24:00" : timeText(entry.visibleEnd)}`;
        row.querySelector("[data-history-duration]").textContent = minuteDuration(entry.duration);
        const { top, height, origin, cardTop, cardCenter } = layout.cards[index];
        row.style.top = `${cardTop}px`;
        const segment = segments.get(entry.id);
        segment.style.top = `${top}px`;
        segment.style.height = `${height}px`;
        segment.title = `${entry.name} · ${row.querySelector("[data-history-range]").textContent}`;
        const connector = connectors.get(entry.id);
        const cardX = row.offsetLeft;
        const midX = (axisX + cardX) / 2;
        connector.querySelector("path").setAttribute("d", `M ${axisX} ${origin} C ${midX} ${origin}, ${midX} ${cardCenter}, ${cardX} ${cardCenter}`);
        connector.querySelector("circle").setAttribute("cx", axisX);
        connector.querySelector("circle").setAttribute("cy", origin);
      }
    }
    $("#history-list").style.height = `${layout.height}px`;
    $("#history-zoom-auto").textContent = zoom === 1 ? "自动" : `${Math.round(zoom * 100)}%`;
    $("#history-zoom-auto").setAttribute("aria-pressed", String(zoom === 1));
    $("#history-zoom-out").disabled = zoom <= .25;
    $("#history-zoom-in").disabled = zoom >= 8;
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
  for (const [id, factor] of [["history-zoom-out", 1 / 1.5], ["history-zoom-in", 1.5], ["history-zoom-auto", 0]]) {
    $(`#${id}`).addEventListener("click", () => {
      zoom = factor ? Math.max(.25, Math.min(8, zoom * factor)) : 1;
      render(getState());
    });
  }
  $("#history-add").addEventListener("click", () => openEditor());
  for (const type of ["pointerover", "pointerout", "focusin", "focusout"]) $("#history-list").addEventListener(type, event => {
    const target = type.endsWith("out") ? event.relatedTarget : event.target;
    const row = target instanceof Element ? target.closest(".history-row") : null;
    const id = row && $("#history-list").contains(row) ? row.dataset.session : null;
    const svg = $("#history-list .history-connectors");
    svg?.classList.toggle("is-highlighting", Boolean(id));
    let highlighted;
    for (const connector of svg?.children ?? []) {
      connector.classList.toggle("is-highlighted", connector.dataset.connector === id);
      if (connector.dataset.connector === id) highlighted = connector;
    }
    if (highlighted) svg.append(highlighted);
  });
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
    // A note-only edit must not round away the seconds in older timer records.
    const existing = getState().sessions.find(session => session.id === editId);
    if (existing) for (const field of ["start", "end"]) {
      if ($(`#history-${field}`).value === localInput(existing[field])) input[field] = existing[field];
    }
    try {
      // Validate before commit so a rejected edit does not disable durable storage.
      saveHistory(getState(), input);
      if (commit(state => saveHistory(state, input), "时间记录已保存。")) $("#history-editor").close();
    } catch (error) { $("#history-editor-error").textContent = error.message; }
  });
  window.addEventListener("resize", () => render(getState()));
  return render;
}
