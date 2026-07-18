/**
 * [INPUT]: 依赖浏览器 document/window、异步位置存储接口、切换回调与状态快照
 * [OUTPUT]: 对外提供双状态浮动按钮、hover 统计渲染、显隐控制和拖拽吸边行为
 * [POS]: src 的界面深模块，向 main.js 隐藏 Shadow DOM、指针手势、布局恢复和响应式定位
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const BUTTON_WIDTH = 104;
const BUTTON_HEIGHT = 38;
const DOCK_MARGIN = 12;
const VALID_EDGES = new Set(["left", "right", "top", "bottom"]);

function formatButtonLabel(active) {
  return active ? "已完成标注" : "标注读音";
}

function calculateDockPosition({
  left,
  top,
  width,
  height,
  viewportWidth,
  viewportHeight,
  margin = DOCK_MARGIN,
}) {
  const maxLeft = Math.max(margin, viewportWidth - width - margin);
  const maxTop = Math.max(margin, viewportHeight - height - margin);
  const x = Math.min(maxLeft, Math.max(margin, left));
  const y = Math.min(maxTop, Math.max(margin, top));
  const distances = {
    left: x - margin,
    right: maxLeft - x,
    top: y - margin,
    bottom: maxTop - y,
  };
  const edge = Object.keys(distances).reduce((best, item) =>
    distances[item] < distances[best] ? item : best,
  );
  const vertical = edge === "left" || edge === "right";
  const snappedLeft = edge === "left" ? margin : edge === "right" ? maxLeft : x;
  const snappedTop = edge === "top" ? margin : edge === "bottom" ? maxTop : y;
  const span = vertical ? maxTop - margin : maxLeft - margin;
  const offset = vertical ? snappedTop - margin : snappedLeft - margin;
  return {
    edge,
    left: snappedLeft,
    top: snappedTop,
    ratio: span > 0 ? offset / span : 0,
  };
}

function createFloatingUi({
  document,
  window,
  hostId,
  loadPosition,
  savePosition,
  onToggle,
  onWarning = () => {},
}) {
  const elements = createElements(document, hostId);
  const state = {
    dockPosition: { edge: "right", ratio: 1 },
    drag: null,
    suppressClickUntil: 0,
    view: { enabled: false, running: false },
  };

  function position(position = state.dockPosition) {
    const width = elements.button.offsetWidth || BUTTON_WIDTH;
    const height = elements.button.offsetHeight || BUTTON_HEIGHT;
    const maxLeft = Math.max(DOCK_MARGIN, window.innerWidth - width - DOCK_MARGIN);
    const maxTop = Math.max(DOCK_MARGIN, window.innerHeight - height - DOCK_MARGIN);
    const ratio = Math.min(1, Math.max(0, Number(position.ratio) || 0));
    const left = edgeCoordinate(position.edge, "left", ratio, maxLeft);
    const top = edgeCoordinate(position.edge, "top", ratio, maxTop);
    elements.dock.style.right = "auto";
    elements.dock.style.bottom = "auto";
    elements.dock.style.left = `${Math.round(left)}px`;
    elements.dock.style.top = `${Math.round(top)}px`;
    setPanelDirection(elements.dock, left, top);
  }

  function render(view) {
    state.view = view;
    elements.button.textContent = formatButtonLabel(view.enabled);
    elements.button.disabled = view.running;
    elements.button.dataset.active = String(view.enabled);
    elements.button.setAttribute(
      "aria-label",
      view.enabled ? "已完成标注，点击移除读音" : "标注读音",
    );
    renderStats(elements.values, view.stats, view.quota);
  }

  function finishDrag(event) {
    const drag = state.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.moved) {
      const rect = elements.dock.getBoundingClientRect();
      state.dockPosition = calculateDockPosition({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      position();
      Promise.resolve(savePosition(state.dockPosition)).catch(onWarning);
      state.suppressClickUntil = window.performance.now() + 400;
    }
    state.drag = null;
    delete elements.dock.dataset.dragging;
  }

  bindPointerEvents(elements, window, state, finishDrag);
  window.addEventListener("resize", () => position());
  elements.button.addEventListener("click", () => {
    if (window.performance.now() < state.suppressClickUntil || state.view.running) return;
    onToggle();
  });
  restorePosition(loadPosition, state, position, onWarning);

  return Object.freeze({
    render,
    setHidden(hidden) {
      elements.host.hidden = hidden;
    },
  });
}

function edgeCoordinate(edge, axis, ratio, max) {
  if (axis === "left") {
    if (edge === "left") return DOCK_MARGIN;
    if (edge === "right") return max;
  }
  if (axis === "top") {
    if (edge === "top") return DOCK_MARGIN;
    if (edge === "bottom") return max;
  }
  return DOCK_MARGIN + ratio * (max - DOCK_MARGIN);
}

function bindPointerEvents(elements, window, state, finishDrag) {
  elements.button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = elements.dock.getBoundingClientRect();
    state.drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    elements.button.setPointerCapture(event.pointerId);
    elements.dock.dataset.dragging = "true";
  });
  elements.button.addEventListener("pointermove", (event) => {
    moveDock(event, elements, window, state);
  });
  elements.button.addEventListener("pointerup", finishDrag);
  elements.button.addEventListener("pointercancel", finishDrag);
}

function moveDock(event, elements, window, state) {
  const drag = state.drag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  event.preventDefault();
  const left = Math.min(
    window.innerWidth - elements.dock.offsetWidth,
    Math.max(0, drag.left + dx),
  );
  const top = Math.min(
    window.innerHeight - elements.dock.offsetHeight,
    Math.max(0, drag.top + dy),
  );
  elements.dock.style.left = `${left}px`;
  elements.dock.style.top = `${top}px`;
  setPanelDirection(elements.dock, left, top);
}

function restorePosition(loadPosition, state, position, onWarning) {
  Promise.resolve(loadPosition(state.dockPosition))
    .then((saved) => {
      if (saved && VALID_EDGES.has(saved.edge)) state.dockPosition = saved;
      position();
    })
    .catch(onWarning);
}

function setPanelDirection(dock, left, top) {
  dock.dataset.panelX = left < 260 ? "right" : "left";
  dock.dataset.panelY = top < 260 ? "below" : "above";
}

function renderStats(values, stats, quota) {
  values.status.textContent = stats.status;
  values.annotated.textContent = `${stats.annotatedCharacters} 字 / ${stats.annotations} 处`;
  values.quota.textContent = `${quota.remaining}/${quota.limit}（近 60 秒）`;
  values.apiCalls.textContent = `${stats.apiCalls} 次（本页会话）`;
  values.cacheHits.textContent = `内存 ${stats.memoryHits} / 本地 ${stats.storageHits}`;
  values.cacheMisses.textContent = `${stats.cacheMisses} 次`;
  values.analyzed.textContent = `${(stats.analyzedBytes / 1024).toFixed(1)} KB`;
  values.skipped.textContent = `${stats.skippedFragments} 个`;
  values.duration.textContent = `${stats.lastDurationMs} ms`;
}

function createElements(document, hostId) {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  const dock = document.createElement("div");
  const button = document.createElement("button");
  const panel = document.createElement("div");
  host.id = hostId;
  dock.className = "dock";
  button.type = "button";
  button.dataset.testid = "scriptcat-furigana-toggle";
  panel.className = "stats";
  panel.setAttribute("role", "tooltip");
  style.textContent = UI_STYLES;
  const values = appendStats(document, panel);
  dock.append(button, panel);
  shadow.append(style, dock);
  document.documentElement.append(host);
  return { host, dock, button, values };
}

function appendStats(document, panel) {
  const values = {};
  const labels = {
    status: "状态",
    annotated: "已标注",
    quota: "API 额度",
    apiCalls: "API 调用",
    cacheHits: "缓存命中",
    cacheMisses: "缓存未命中",
    analyzed: "已分析文本",
    skipped: "异常片段",
    duration: "最近耗时",
  };
  for (const [key, label] of Object.entries(labels)) {
    const row = document.createElement("div");
    const name = document.createElement("span");
    const value = document.createElement("span");
    row.className = "row";
    name.className = "name";
    value.className = "value";
    name.textContent = label;
    row.append(name, value);
    panel.append(row);
    values[key] = value;
  }
  return values;
}

const UI_STYLES = `
  :host { all: initial; }
  .dock { position:fixed; right:12px; bottom:12px; z-index:2147483647; }
  button { width:104px; height:38px; padding:0 12px; touch-action:none; user-select:none; border:1px solid rgba(255,255,255,.22); border-radius:12px; color:#fff; background:#242424; box-shadow:0 8px 24px rgba(0,0,0,.24); font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; cursor:grab; }
  button:hover { background:#111; }
  .dock[data-dragging="true"] button { cursor:grabbing; }
  button:disabled { cursor:wait; opacity:.68; }
  button[data-active="true"] { background:#236746; }
  .stats { position:absolute; right:0; bottom:calc(100% + 8px); width:240px; padding:11px 13px; border:1px solid rgba(255,255,255,.12); border-radius:12px; color:#f7f7f7; background:rgba(24,24,24,.96); box-shadow:0 12px 34px rgba(0,0,0,.3); font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; opacity:0; transform:translateY(5px); pointer-events:none; transition:opacity .15s ease,transform .15s ease; }
  .dock[data-panel-y="below"] .stats { top:calc(100% + 8px); bottom:auto; }
  .dock[data-panel-x="right"] .stats { left:0; right:auto; }
  .dock[data-dragging="true"] .stats { opacity:0; }
  button:hover + .stats, button:focus-visible + .stats { opacity:1; transform:none; }
  .row { display:flex; justify-content:space-between; gap:16px; padding:3px 0; }
  .name { color:#aaa; }
  .value { color:#fff; text-align:right; }
`;

module.exports = Object.freeze({
  calculateDockPosition,
  createFloatingUi,
  formatButtonLabel,
});
