/**
 * [INPUT]: 依赖 page、reader、control、platform Module Interface 与 runtime Adapter
 * [OUTPUT]: 对外提供 start() 与 toggle()，启动并切换完整注音会话
 * [POS]: page 的注音会话深 Module，隐藏状态流、统计合并、动态正文观察、页面标注和失败恢复
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

function createFuriganaApp({ page, reader, control, platform, runtime }) {
  let enabled = false;
  let running = false;
  let stopObserver = null;
  let mutationTask = null;
  const session = createSessionStats();

  function render() {
    const reading = reader.snapshot();
    control.render({
      enabled,
      running,
      stats: { ...reading.metrics, ...session },
      quota: reading.quota,
    });
  }

  function disconnectObserver() {
    if (stopObserver) stopObserver();
    if (mutationTask) runtime.cancel(mutationTask);
    stopObserver = null;
    mutationTask = null;
  }

  function connectObserver() {
    disconnectObserver();
    stopObserver = runtime.observeAdded(() => {
      if (running || !enabled) return;
      if (mutationTask) runtime.cancel(mutationTask);
      mutationTask = runtime.schedule(() => {
        mutationTask = null;
        annotate({ incremental: true }).catch(reportFailure);
      }, 800);
    });
  }

  async function annotate({ incremental = false } = {}) {
    if (running) return;
    const startedAt = runtime.now();
    if (!incremental) resetSessionStats(session);
    running = true;
    session.status = "正在分析";
    disconnectObserver();
    render();
    try {
      const groups = page.collect();
      const analyses = await reader.analyze(
        groups.map((group) => group.text),
        { incremental },
      );
      const applied = page.apply(groups, analyses);
      session.annotatedCharacters += applied.characters;
      session.annotations += applied.annotations;
      session.lastDurationMs = Math.round(runtime.now() - startedAt);
      session.status = "已完成";
      enabled = true;
      connectObserver();
    } finally {
      running = false;
      render();
    }
  }

  function disableAnnotations() {
    disconnectObserver();
    page.remove();
    enabled = false;
    session.status = "已撤销";
    session.annotatedCharacters = 0;
    session.annotations = 0;
    render();
  }

  function reportFailure(error) {
    running = false;
    session.status = "失败";
    if (enabled) connectObserver();
    render();
    platform.reportError(error);
  }

  async function toggle() {
    if (running) return;
    if (enabled) {
      disableAnnotations();
      return;
    }
    try {
      await annotate();
    } catch (error) {
      reportFailure(error);
    }
  }

  async function refreshVisibility() {
    const forced = await platform.isButtonForced();
    control.setHidden(!(forced || page.isJapanesePage()));
  }

  async function start() {
    render();
    runtime.repeat(render, 1_000);
    platform.registerMenus({ onVisibilityChange: refreshVisibility });
    try {
      await refreshVisibility();
    } catch (error) {
      reportFailure(error);
    }
  }

  return Object.freeze({ start, toggle });
}

function createBrowserRuntime({ window, document }) {
  return Object.freeze({
    now: () => window.performance.now(),
    repeat: (callback, delay) => window.setInterval(callback, delay),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: (task) => window.clearTimeout(task),
    observeAdded(callback) {
      const observer = new window.MutationObserver((mutations) => {
        if (mutations.some((mutation) => mutation.addedNodes.length > 0)) callback();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
  });
}

function createSessionStats() {
  return {
    status: "待标注",
    annotatedCharacters: 0,
    annotations: 0,
    lastDurationMs: 0,
  };
}

function resetSessionStats(session) {
  session.annotatedCharacters = 0;
  session.annotations = 0;
}

module.exports = Object.freeze({ createBrowserRuntime, createFuriganaApp });
