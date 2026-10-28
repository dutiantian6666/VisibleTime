import { activeSession, createTask, dayBounds, durationText, startTimer, stopTimer, toggleTask } from "./core.js";
import { historyForDay, localDate, localInput } from "./history.js";

export function savePlan(state, { id, name, start, end, note = "" }, now = Date.now()) {
  name = name.trim();
  note = note.trim();
  if (!name || name.length > 80 || note.length > 200) throw new Error("事项名称为 1—80 字，备注最多 200 字。");
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > 8640000000000000 ||
      end <= start || start % 60000 || end % 60000) throw new Error("计划按分钟设置，结束时间须晚于开始时间。");
  const existing = (state.plans ?? []).find(plan => plan.id === id);
  if (id && !existing) throw new Error("计划已不存在，请刷新后重试。");
  let next = state;
  let task = state.tasks.find(task => task.name === name);
  if (!task) {
    next = createTask(state, name, now);
    task = next.tasks.at(-1);
  }
  if (existing && task.id !== existing.taskId && state.sessions.some(session => session.planId === id)) {
    throw new Error("这项计划已有实际记录，请保留原事项，或另建一项计划。");
  }
  const plan = {
    ...(existing ?? { id: crypto.randomUUID(), createdAt: now, completed: false }),
    taskId: task.id, start, end, note,
  };
  return { ...next, plans: existing ? next.plans.map(item => item.id === id ? plan : item) : [...(next.plans ?? []), plan] };
}

export function deletePlan(state, id) {
  if (!(state.plans ?? []).some(plan => plan.id === id)) throw new Error("计划已不存在。");
  // Deleting a schedule never deletes actual time that has already been recorded.
  return {
    ...state, plans: state.plans.filter(plan => plan.id !== id),
    sessions: state.sessions.map(session => {
      if (session.planId !== id) return session;
      const { planId, ...record } = session;
      return record;
    }),
  };
}

export function startPlan(state, id, now = Date.now()) {
  const plan = (state.plans ?? []).find(plan => plan.id === id);
  if (!plan) throw new Error("计划已不存在。");
  if (activeSession(state)?.planId === id) return state;
  let next = stopTimer(state, now);
  if (next.tasks.find(task => task.id === plan.taskId)?.completed) next = toggleTask(next, plan.taskId, now);
  next = startTimer(next, plan.taskId, now);
  return {
    ...next,
    plans: next.plans.map(item => item.id === id ? { ...item, completed: false } : item),
    sessions: next.sessions.map(session => session.end === null ? { ...session, planId: id } : session),
  };
}

export function togglePlan(state, id, now = Date.now()) {
  const plan = (state.plans ?? []).find(plan => plan.id === id);
  if (!plan) throw new Error("计划已不存在。");
  const next = activeSession(state)?.planId === id && !plan.completed ? stopTimer(state, now) : state;
  return { ...next, plans: next.plans.map(item => item.id === id ? { ...item, completed: !item.completed } : item) };
}

export function plansForDay(state, date) {
  const bounds = dayBounds(date);
  return (state.plans ?? []).filter(plan => plan.start < bounds.end && plan.end > bounds.start)
    .map(plan => ({ ...plan, visibleStart: Math.max(bounds.start, plan.start), visibleEnd: Math.min(bounds.end, plan.end) }))
    .sort((a, b) => a.start - b.start);
}

export function actualForPlan(state, id, now = Date.now()) {
  return state.sessions.filter(session => session.planId === id)
    .reduce((total, session) => total + Math.max(0, (session.end ?? now) - session.start), 0);
}

export function monthDates(date) {
  const first = new Date(date);
  first.setDate(1);
  first.setHours(12, 0, 0, 0);
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, offset) => {
    const day = new Date(first);
    day.setDate(day.getDate() + offset);
    return day;
  });
}

export function attachCalendar({ getState, commit, notify, element }) {
  const $ = selector => document.querySelector(selector);
  let selectedDay = localDate();
  let editId = null;
  let monthKey = "";
  let agendaKey = "";
  const selectedTime = () => new Date(`${selectedDay}T12:00:00`).getTime();
  const timeText = value => new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const taskName = (state, id) => state.tasks.find(task => task.id === id)?.name ?? "事项";
  function render(state, now = Date.now()) {
    if ($("#calendar-view").hidden) return;
    const current = new Date(selectedTime());
    $("#calendar-month").textContent = `${current.getFullYear()} 年 ${current.getMonth() + 1} 月`;
    $("#calendar-date").value = selectedDay;
    const active = activeSession(state);
    const key = JSON.stringify([state.plans, state.sessions, state.tasks, selectedDay, localDate(now), active ? active.start < now : false]);
    if (key !== monthKey) {
      monthKey = key;
      const cells = monthDates(current).map(date => {
        const value = localDate(date);
        const plans = plansForDay(state, date);
        const recorded = historyForDay(state, date, "", now).length;
        const cell = element("button", "calendar-cell");
        cell.type = "button";
        cell.dataset.day = value;
        cell.classList.toggle("outside-month", date.getMonth() !== current.getMonth());
        cell.classList.toggle("selected", value === selectedDay);
        cell.classList.toggle("is-today", value === localDate(now));
        cell.setAttribute("aria-pressed", String(value === selectedDay));
        cell.setAttribute("aria-label", `${value}，${plans.length} 项计划，${recorded} 段实际记录`);
        cell.append(element("span", "calendar-day-number", date.getDate()));
        plans.slice(0, 2).forEach(plan => cell.append(element("span", `calendar-cell-plan${plan.completed ? " done" : ""}`, taskName(state, plan.taskId))));
        if (plans.length > 2) cell.append(element("span", "calendar-cell-more", `另 ${plans.length - 2} 项`));
        if (recorded) cell.append(element("span", "calendar-record-dot", `${recorded} 段足迹`));
        return cell;
      });
      $("#calendar-grid").replaceChildren(...cells);
    }
    const plans = plansForDay(state, selectedTime());
    const actual = historyForDay(state, selectedTime(), "", now);
    $("#calendar-day-title").textContent = `${current.getMonth() + 1} 月 ${current.getDate()} 日 · 时间安排`;
    const planned = plans.reduce((sum, plan) => sum + plan.visibleEnd - plan.visibleStart, 0);
    $("#calendar-summary").textContent = `计划 ${durationText(planned)} · 实际 ${durationText(actual.reduce((sum, item) => sum + item.duration, 0))}`;
    // Preserve button focus while only the elapsed durations change.
    if (agendaKey !== key) {
      agendaKey = key;
      $("#calendar-plans").replaceChildren(...plans.map(plan => {
        const row = element("article", `plan-row${plan.completed ? " done" : ""}`);
        row.dataset.plan = plan.id;
        const conflicting = plans.some(other => other.id !== plan.id && other.start < plan.end && other.end > plan.start);
        const range = element("span", "agenda-time", `${timeText(plan.visibleStart)}—${plan.visibleEnd === dayBounds(selectedTime()).end ? "24:00" : timeText(plan.visibleEnd)}`);
        const info = element("div", "agenda-info");
        info.append(element("h4", "", taskName(state, plan.taskId)));
        const duration = element("p", "plan-duration");
        duration.dataset.planDuration = plan.id;
        info.append(duration);
        if (plan.note) info.append(element("p", "plan-note", plan.note));
        if (conflicting) info.append(element("span", "plan-conflict", "与其他计划时间重叠"));
        const controls = element("div", "plan-actions");
        const check = element("button", "plan-complete", plan.completed ? "✓ 已完成" : "标记完成");
        check.type = "button"; check.dataset.planAction = "complete";
        check.setAttribute("aria-label", `${plan.completed ? "恢复计划" : "完成计划"}：${taskName(state, plan.taskId)}`);
        check.setAttribute("aria-pressed", String(plan.completed));
        controls.append(check);
        for (const [action, label] of [["start", "开始计时"], ["edit", "修改"], ["delete", "删除"]]) {
          const button = element("button", "", label);
          button.type = "button"; button.dataset.planAction = action;
          if (action === "start" && activeSession(state)?.planId === plan.id) { button.textContent = "正在计时"; button.disabled = true; }
          controls.append(button);
        }
        row.append(range, info, controls);
        return row;
      }));
      $("#calendar-actual").replaceChildren(...actual.map(entry => {
        const row = element("article", "actual-row");
        const info = element("div", "agenda-info");
        info.append(element("h4", "", entry.name));
        const meta = element("p", "", entry.planId ? "来自日历计划" : entry.source === "manual" ? "手动补录" : "专注计时");
        info.append(meta);
        const time = element("span", "agenda-time");
        time.dataset.actualRange = entry.id;
        const duration = element("strong", "actual-duration");
        duration.dataset.actualDuration = entry.id;
        row.append(time, info, duration);
        return row;
      }));
    }
    for (const plan of plans) {
      const label = [...document.querySelectorAll("[data-plan-duration]")].find(node => node.dataset.planDuration === plan.id);
      if (label) label.textContent = `计划 ${durationText(plan.end - plan.start)} · 累计实际 ${durationText(actualForPlan(state, plan.id, now))}`;
    }
    for (const entry of actual) {
      const range = [...document.querySelectorAll("[data-actual-range]")].find(node => node.dataset.actualRange === entry.id);
      const duration = [...document.querySelectorAll("[data-actual-duration]")].find(node => node.dataset.actualDuration === entry.id);
      if (range) range.textContent = `${timeText(entry.visibleStart)}—${entry.end === null ? "现在" : timeText(entry.visibleEnd)}`;
      if (duration) duration.textContent = durationText(entry.duration);
    }
    $("#calendar-plans-empty").hidden = plans.length > 0;
    $("#calendar-actual-empty").hidden = actual.length > 0;
  }
  function openEditor(id = null) {
    editId = id;
    const state = getState();
    const plan = (state.plans ?? []).find(item => item.id === id);
    const start = plan?.start ?? new Date(`${selectedDay}T09:00:00`).getTime();
    $("#plan-editor-title").textContent = plan ? "修改日历计划" : "给时间留一个位置";
    $("#plan-task").value = plan ? taskName(state, plan.taskId) : "";
    $("#plan-start").value = localInput(start).slice(0, 16);
    $("#plan-end").value = localInput(plan?.end ?? start + 30 * 60000).slice(0, 16);
    $("#plan-note").value = plan?.note ?? "";
    $("#plan-editor-error").textContent = "";
    $("#plan-editor").showModal();
  }
  $("#calendar-grid").addEventListener("click", event => {
    const cell = event.target.closest("[data-day]");
    if (cell) { selectedDay = cell.dataset.day; render(getState()); }
  });
  $("#calendar-date").addEventListener("change", event => {
    if (event.target.value) { selectedDay = event.target.value; render(getState()); }
  });
  for (const [id, offset] of [["calendar-prev", -1], ["calendar-next", 1], ["calendar-today", 0]]) {
    $(`#${id}`).addEventListener("click", () => {
      if (!offset) selectedDay = localDate();
      else {
        const date = new Date(selectedTime());
        const day = date.getDate();
        date.setDate(1); date.setMonth(date.getMonth() + offset);
        const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        date.setDate(Math.min(day, last));
        selectedDay = localDate(date);
      }
      render(getState());
    });
  }
  $("#calendar-add").addEventListener("click", () => openEditor());
  $("#plan-editor-close").addEventListener("click", () => $("#plan-editor").close());
  $("#plan-editor-form").addEventListener("submit", event => {
    event.preventDefault();
    try {
      const input = {
        id: editId, name: $("#plan-task").value, start: new Date($("#plan-start").value).getTime(),
        end: new Date($("#plan-end").value).getTime(), note: $("#plan-note").value,
      };
      savePlan(getState(), input);
      if (commit(current => savePlan(current, input), "日历计划已保存。")) {
        selectedDay = localDate(input.start); $("#plan-editor").close(); render(getState());
      }
    } catch (error) { $("#plan-editor-error").textContent = error.message; }
  });
  $("#calendar-plans").addEventListener("click", event => {
    const button = event.target.closest("[data-plan-action]");
    if (!button) return;
    const id = button.closest("[data-plan]").dataset.plan;
    try {
      switch (button.dataset.planAction) {
        case "edit": openEditor(id); break;
        case "delete":
          if (confirm("删除这项日历计划？已经记录的实际用时会保留。")) commit(current => deletePlan(current, id), "计划已删除，实际记录已保留。");
          break;
        case "complete": commit(current => togglePlan(current, id), "计划状态已更新。"); break;
        case "start":
          if (commit(current => startPlan(current, id), "已开始计时，实际时间从现在记录。")) $('[data-view="focus"]').click();
          break;
      }
    } catch (error) { notify(error.message); }
  });
  return render;
}
