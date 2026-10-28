import {
  STORAGE_KEY, emptyState, parseState, activeSession, createTask,
  startTimer, stopTimer, toggleTask, dailyStats, clockText, durationText,
} from "./core.js";

const $ = selector => document.querySelector(selector);
let state = emptyState();
let storedRaw = null;
let storageBlocked = false;
let filter = "pending";
let renderedTaskKey = "";
let toastTimeout;

function notify(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { $("#toast").hidden = true; }, 3500);
}

function warn(message) {
  storageBlocked = true;
  $("#storage-warning").textContent = message;
  $("#storage-warning").hidden = false;
  $("#save-status").textContent = "本地存储需要处理";
}

function readStorage() {
  try {
    storedRaw = localStorage.getItem(STORAGE_KEY);
    state = parseState(storedRaw);
    storageBlocked = false;
    $("#storage-warning").hidden = true;
    $("#save-status").replaceChildren();
    const dot = document.createElement("span");
    dot.className = "status-dot";
    $("#save-status").append(dot, "数据保存在当前浏览器");
  } catch {
    warn("无法读取本地记录。为避免覆盖已有数据，已暂停写入。请保留浏览器数据，检查存储权限或备份原始记录后再处理。");
  }
}

function commit(transform, message) {
  if (storageBlocked) return notify("本地存储暂不可用，请先处理页面提示。");
  try {
    // Check the latest saved value before applying an action from another tab.
    const latestRaw = localStorage.getItem(STORAGE_KEY);
    if (latestRaw !== storedRaw) {
      state = parseState(latestRaw);
      storedRaw = latestRaw;
    }
    const next = transform(state);
    const raw = JSON.stringify(next);
    localStorage.setItem(STORAGE_KEY, raw);
    state = next;
    storedRaw = raw;
    render();
    if (message) notify(message);
    return true;
  } catch {
    warn("保存未成功，本次操作未写入。请检查浏览器存储权限和可用空间；已有记录仍保留在浏览器中。");
    render();
    return false;
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderTasks(stats, active) {
  const visibleTasks = state.tasks.filter(task =>
    filter === "all" || (filter === "completed" ? task.completed : !task.completed));
  const taskKey = JSON.stringify([visibleTasks, active?.taskId, filter, storageBlocked]);
  if (taskKey !== renderedTaskKey) {
    renderedTaskKey = taskKey;
    const fragment = document.createDocumentFragment();
    for (const task of visibleTasks) {
      const running = active?.taskId === task.id;
      const row = element("div", `task-row${task.completed ? " is-completed" : ""}${running ? " is-active" : ""}`);
      row.dataset.taskId = task.id;
      const check = element("button", "task-check", task.completed ? "✓" : "");
      check.type = "button";
      check.dataset.action = "complete";
      check.setAttribute("aria-label", `${task.completed ? "恢复任务" : "完成任务"}：${task.name}`);
      check.setAttribute("aria-pressed", String(task.completed));
      check.disabled = storageBlocked;
      const info = element("div", "task-info");
      info.append(element("div", "task-name", task.name));
      if (running) info.append(element("span", "task-running", "正在专注"));
      const time = element("span", "task-time");
      time.dataset.timeFor = task.id;
      row.append(check, info, time);
      if (!task.completed) {
        const toggle = element("button", "task-toggle");
        toggle.type = "button";
        toggle.dataset.action = running ? "stop" : "start";
        toggle.setAttribute("aria-label", `${running ? "暂停计时" : "开始计时"}：${task.name}`);
        toggle.disabled = storageBlocked;
        const icon = element("span", running ? "pause-icon" : "play-icon");
        icon.setAttribute("aria-hidden", "true");
        toggle.append(icon);
        row.append(toggle);
      }
      fragment.append(row);
    }
    $("#task-list").replaceChildren(fragment);
  }
  document.querySelectorAll("[data-time-for]").forEach(node => {
    node.textContent = clockText(stats.byTask.get(node.dataset.timeFor) ?? 0);
  });
  $("#task-empty").hidden = visibleTasks.length > 0;
  const emptyText = filter === "completed" ? ["完成一件，就少一份牵挂", "完成的任务会出现在这里，投入的时间也会留下。"] :
    state.tasks.length > 0 ? ["手头的事情，已经告一段落", "歇一歇，或者再写下一件想做的小事。"] :
      ["给今天一个小小的开始", "写下一件想做的事，剩下的交给专注。"];
  $("#empty-title").textContent = emptyText[0];
  $("#empty-description").textContent = emptyText[1];
}

function renderDistribution(stats) {
  const entries = [...stats.byTask.entries()].sort((a, b) => b[1] - a[1]);
  $("#distribution-count").textContent = entries.length ? `${entries.length} 项任务` : "等待第一段专注";
  const fragment = document.createDocumentFragment();
  if (!entries.length) {
    const bars = element("div", "distribution-empty");
    bars.setAttribute("aria-label", "暂无时间记录");
    [25, 40, 30, 50, 35, 60, 42, 30, 55, 65, 40, 55, 75, 50, 65, 85, 65, 95, 70, 85, 60, 80, 70, 95].forEach(height => {
      const bar = element("span");
      bar.style.height = `${height}%`;
      bars.append(bar);
    });
    fragment.append(bars);
  } else {
    const displayed = entries.slice(0, 3).map(([taskId, duration]) => ({
      name: state.tasks.find(task => task.id === taskId)?.name ?? "任务", duration,
    }));
    if (entries.length > 3) displayed.push({
      name: `其他 ${entries.length - 3} 项`,
      duration: entries.slice(3).reduce((sum, [, duration]) => sum + duration, 0),
    });
    for (const entry of displayed) {
      const row = element("div", "distribution-row");
      const name = element("span", "distribution-name", entry.name);
      name.title = entry.name;
      const track = element("div", "distribution-track");
      const fill = element("div", "distribution-fill");
      fill.style.width = `${(entry.duration / stats.total) * 100}%`;
      track.append(fill);
      const value = element("span", "distribution-value", durationText(entry.duration));
      row.append(name, track, value);
      fragment.append(row);
    }
  }
  $("#distribution-list").replaceChildren(fragment);
}

function render() {
  const now = Date.now();
  const date = new Date(now);
  const stats = dailyStats(state, now);
  const active = activeSession(state);
  const currentTask = state.tasks.find(task => task.id === active?.taskId);
  const pending = state.tasks.filter(task => !task.completed);
  $("#date-weekday").textContent = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date);
  $("#date-label").textContent = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  $("#date-label").dateTime = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  $("#pending-count").textContent = pending.length;
  $("#completed-count").textContent = state.tasks.length - pending.length;
  $("#focus-task").textContent = currentTask?.name ?? (pending.length ? "准备好，就从现在开始" : "从一件小事开始");
  $("#focus-task").title = currentTask?.name ?? "";
  const elapsed = active ? Math.max(0, now - active.start) : 0;
  $("#timer").textContent = clockText(elapsed);
  $("#focus-status").textContent = active ? "专注进行中" : "准备开始";
  $("#focus-status").classList.toggle("running", Boolean(active));
  $("#focus-caption").textContent = active ? `本次从 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(active.start)} 开始 · 按自己的节奏来` :
    "选择一项任务，让时间开始流动";
  $("#focus-action-label").textContent = active ? "暂停，歇一歇" : pending.length ? "开始下一项任务" : "添加第一项任务";
  $("#focus-action > span:first-child").className = active ? "pause-icon" : "play-icon";
  $("#focus-footer-text").textContent = active ? "关闭页面后仍会计时，离开前记得暂停。" : "每一段投入，都值得被看见。";
  $(".timer-orbit").style.setProperty("--timer-angle", `${Math.floor(elapsed / 1000) * 6}deg`);
  $("#focus-action").disabled = storageBlocked;
  $("#add-task").disabled = storageBlocked;
  $("#task-input").disabled = storageBlocked;

  const totalMinutes = Math.floor(stats.total / 60000);
  const total = $("#total-time");
  total.replaceChildren();
  if (totalMinutes >= 60) total.append(element("strong", "", Math.floor(totalMinutes / 60)), element("span", "", "时"));
  total.append(element("strong", "", totalMinutes % 60), element("span", "", "分"));
  total.setAttribute("aria-label", `今日总投入 ${durationText(stats.total)}`);
  $("#daily-caption").textContent = stats.total ? `已记录 ${durationText(stats.total)}，每一点投入都有意义` : "今天的故事，等你写下第一笔";
  $("#session-count").textContent = stats.sessionCount;
  $("#done-today").textContent = stats.completedCount;
  renderTasks(stats, active);
  renderDistribution(stats);
}

$("#task-form").addEventListener("submit", event => {
  event.preventDefault();
  const name = $("#task-input").value.trim();
  if (!name) {
    $("#task-input").value = "";
    $("#task-input").focus();
    return notify("先给这件事起个名字吧。");
  }
  if (commit(current => createTask(current, name), "任务已添加，随时可以开始。")) {
    $("#task-input").value = "";
    filter = "pending";
    updateFilters();
    render();
    $("#task-input").focus();
  }
});

$("#focus-action").addEventListener("click", () => {
  if (activeSession(state)) {
    commit(current => stopTimer(current), "已暂停，这段投入已经记下。");
  } else if (state.tasks.some(task => !task.completed)) {
    commit(current => {
      const next = current.tasks.find(task => !task.completed);
      return next ? startTimer(current, next.id) : current;
    });
  } else {
    $("#task-input").focus();
    $("#task-input").scrollIntoView({ block: "center", behavior: "smooth" });
  }
});

$("#task-list").addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const taskId = button.closest("[data-task-id]").dataset.taskId;
  const action = button.dataset.action;
  if (action === "start") {
    commit(current => startTimer(current, taskId));
  } else if (action === "stop") {
    commit(current => activeSession(current)?.taskId === taskId ? stopTimer(current) : current, "已暂停，时间已记录。");
  } else if (action === "complete") {
    commit(current => toggleTask(current, taskId));
  }
});

function updateFilters() {
  document.querySelectorAll("[data-filter]").forEach(button => {
    const selected = button.dataset.filter === filter;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

document.querySelectorAll("[data-filter]").forEach(button => {
  button.addEventListener("click", () => {
    filter = button.dataset.filter;
    updateFilters();
    render();
  });
});

window.addEventListener("storage", event => {
  if (event.key === STORAGE_KEY || event.key === null) {
    readStorage();
    render();
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { readStorage(); render(); }
});
readStorage();
render();
setInterval(render, 1000);
