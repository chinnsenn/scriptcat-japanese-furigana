/**
 * [INPUT]: 依赖浏览器 document/window、异步位置存储接口、切换回调与状态快照
 * [OUTPUT]: 对外提供纯图标圆形状态按钮、环形进度/取消、韧性统计面板、显隐与拖拽吸边行为
 * [POS]: page 的界面深 Module，向 app.js 隐藏 Shadow DOM、指针手势、布局恢复和响应式定位
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const BUTTON_SIZE = 48;
const DOCK_MARGIN = 12;
const VALID_EDGES = new Set(["left", "right", "top", "bottom"]);

function formatButtonAccessibleLabel(active, running = false, stats = {}) {
  if (running) {
    return `正在处理 ${stats.completed || 0}/${stats.total || 0}，点击取消`;
  }
  return active ? "注音已完成，点击移除读音" : "为网页汉字标注读音";
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
    const width = elements.button.offsetWidth || BUTTON_SIZE;
    const height = elements.button.offsetHeight || BUTTON_SIZE;
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
    const label = formatButtonAccessibleLabel(view.enabled, view.running, view.stats);
    const total = view.stats.total || 0;
    const progress = total > 0 ? Math.min(100, (view.stats.completed / total) * 100) : 8;
    elements.button.disabled = false;
    elements.button.dataset.active = String(view.enabled);
    elements.button.dataset.running = String(view.running);
    elements.button.style.setProperty("--progress-offset", String(100 - progress));
    elements.button.setAttribute("aria-label", label);
    elements.button.setAttribute("aria-pressed", String(view.enabled));
    elements.button.setAttribute("aria-busy", String(view.running));
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
    if (window.performance.now() < state.suppressClickUntil) return;
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
  values.progress.textContent = `${stats.completed || 0}/${stats.total || 0}`;
  values.annotated.textContent = `${stats.annotatedCharacters} 字 / ${stats.annotations} 处`;
  values.quota.textContent = `${quota.remaining}/${quota.limit}（近 60 秒）`;
  values.apiCalls.textContent = `${stats.apiCalls} 次（本次会话）`;
  values.rateLimitRetries.textContent = `${stats.rateLimitRetries} 次`;
  values.transientRetries.textContent = `${stats.transientRetries || 0} 次`;
  values.waited.textContent = `${stats.waitedMs || 0} ms`;
  values.cacheHits.textContent = `内存 ${stats.memoryHits} / 本地 ${stats.storageHits}`;
  values.cacheMisses.textContent = `${stats.cacheMisses} 次`;
  values.analyzed.textContent = `${(stats.analyzedBytes / 1024).toFixed(1)} KB`;
  values.skipped.textContent = `${stats.skippedFragments} 个`;
  values.failed.textContent = `${stats.failedFragments || 0} 个`;
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
  button.append(createButtonIcon(document));
  panel.className = "stats";
  panel.setAttribute("role", "tooltip");
  style.textContent = UI_STYLES;
  const values = appendStats(document, panel);
  dock.append(button, panel);
  shadow.append(style, dock);
  document.documentElement.append(host);
  return { host, dock, button, values };
}

function createButtonIcon(document) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("furigana-mark");
  appendSvg(document, svg, "circle", {
    class: "progress-ring",
    cx: "24",
    cy: "24",
    r: "21",
    pathLength: "100",
  });
  appendSvg(document, svg, "path", {
    class: "reading-mark",
    d: "M14 14h2m7 0h2m7 0h2",
  });
  appendSvg(document, svg, "path", {
    class: "character-mark",
    d: "M14 21h20M18 21v13m12-13v13M16 27h16M16 34h16",
  });
  return svg;
}

function appendSvg(document, parent, tag, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  parent.append(element);
}

function appendStats(document, panel) {
  const values = {};
  const labels = {
    status: "状态",
    progress: "处理进度",
    annotated: "已标注",
    quota: "API 额度",
    apiCalls: "API 调用",
    rateLimitRetries: "限流重试",
    transientRetries: "瞬时重试",
    waited: "限流等待",
    cacheHits: "缓存命中",
    cacheMisses: "缓存未命中",
    analyzed: "已分析文本",
    skipped: "异常片段",
    failed: "失败片段",
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
  button { --progress-offset:100; position:relative; display:grid; place-items:center; width:48px; height:48px; padding:0; touch-action:none; user-select:none; border:1px solid rgba(248,241,222,.32); border-radius:50%; color:#f4eedf; background:#252620; box-shadow:0 2px 0 rgba(255,255,255,.08) inset,0 10px 28px rgba(25,24,20,.28); cursor:grab; transition:transform .18s cubic-bezier(.22,1,.36,1),background-color .18s ease,color .18s ease,box-shadow .18s ease; }
  button:hover { transform:scale(1.045); background:#181914; box-shadow:0 2px 0 rgba(255,255,255,.1) inset,0 13px 32px rgba(25,24,20,.34); }
  button:focus-visible { outline:3px solid rgba(169,193,146,.72); outline-offset:3px; }
  .dock[data-dragging="true"] button { cursor:grabbing; }
  button[data-running="true"] { cursor:progress; background:#302f26; }
  button[data-active="true"] { color:#e3f1dd; background:#27483b; box-shadow:0 2px 0 rgba(255,255,255,.1) inset,0 10px 28px rgba(24,57,44,.3); }
  .furigana-mark { display:block; width:42px; height:42px; overflow:visible; fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; }
  .progress-ring { opacity:0; stroke:#c7b36b; stroke-width:2; stroke-dasharray:100; stroke-dashoffset:var(--progress-offset); transform:rotate(-90deg); transform-origin:center; transition:stroke-dashoffset .2s ease,opacity .2s ease; }
  .reading-mark { stroke-width:3.2; }
  .character-mark { stroke-width:2.25; }
  button[data-running="true"] .progress-ring { opacity:1; }
  button[data-running="true"] .reading-mark { animation:reading-pulse .8s ease-in-out infinite alternate; }
  .stats { position:absolute; right:0; bottom:calc(100% + 10px); width:240px; padding:12px 14px; border:1px solid rgba(244,238,223,.14); border-radius:16px; color:#f4eedf; background:rgba(32,33,27,.97); box-shadow:0 16px 42px rgba(25,24,20,.3); font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; opacity:0; transform:translateY(6px) scale(.985); transform-origin:bottom right; pointer-events:none; transition:opacity .16s ease,transform .18s cubic-bezier(.22,1,.36,1); }
  .dock[data-panel-y="below"] .stats { top:calc(100% + 8px); bottom:auto; }
  .dock[data-panel-x="right"] .stats { left:0; right:auto; }
  .dock[data-dragging="true"] .stats { opacity:0; }
  button:hover + .stats, button:focus-visible + .stats { opacity:1; transform:translateY(0) scale(1); }
  .row { display:flex; justify-content:space-between; gap:16px; padding:3px 0; }
  .name { color:#aaa997; }
  .value { color:#f4eedf; text-align:right; }
  @keyframes reading-pulse { from { opacity:.38; } to { opacity:1; } }
  @media (prefers-reduced-motion:reduce) { button,.stats,.progress-ring { transition:none; } button[data-running="true"] .reading-mark { animation:none; } }
`;

module.exports = Object.freeze({
  calculateDockPosition,
  createFloatingUi,
  formatButtonAccessibleLabel,
});
