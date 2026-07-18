/**
 * [INPUT]: 依赖 page 的三态语言区间、reader、control、platform Interface 与可取消、可观察正文的 runtime
 * [OUTPUT]: 对外提供 start、toggle、retryFailures，只分析日语区间并统计语言跳过、进度与失败
 * [POS]: page 的注音会话深 Module，隐藏语言过滤、状态流、脏区、取消、局部标注与失败恢复
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const { LANGUAGE_KIND } = require("../text");

function createFuriganaApp({ page, reader, control, platform, runtime }) {
  let enabled = false;
  let running = false;
  let stopObserver = null;
  let mutationTask = null;
  let activeScope = "page";
  let abortController = null;
  let failedJobs = [];
  const dirtyRoots = new Set();
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

  function pauseObserver() {
    if (stopObserver) stopObserver();
    stopObserver = null;
  }

  function resumeObserver() {
    if (!stopObserver) stopObserver = runtime.observeChanges(queueChanges);
  }

  function cancelMutationTask() {
    if (mutationTask) runtime.cancel(mutationTask);
    mutationTask = null;
  }

  function queueChanges(roots = []) {
    for (const root of roots) {
      enqueueDirtyRoot(dirtyRoots, root);
    }
    if (!running) scheduleChangeProcessing();
  }

  function scheduleChangeProcessing() {
    cancelMutationTask();
    mutationTask = runtime.schedule(() => {
      mutationTask = null;
      if (enabled) {
        annotate({ incremental: true }).catch(reportFailure);
        return;
      }
      dirtyRoots.clear();
      refreshVisibility().catch(reportFailure);
    }, 800);
  }

  async function collectGroups(incremental) {
    if (!incremental) {
      dirtyRoots.clear();
      activeScope = await platform.getDefaultScope();
      return page.collect({ scope: activeScope });
    }
    const roots = Array.from(dirtyRoots);
    dirtyRoots.clear();
    return roots.flatMap((root) => page.collect({ scope: activeScope, root }));
  }

  async function annotate({ incremental = false, retryJobs = null } = {}) {
    if (running) return;
    cancelMutationTask();
    const startedAt = runtime.now();
    if (!incremental) {
      resetSessionStats(session);
      failedJobs = [];
    }
    running = true;
    session.status = "正在分析";
    abortController = runtime.createAbortController();
    render();
    try {
      const collectedGroups = retryJobs
        ? retryJobs.map((job) => job.group)
        : await collectGroups(incremental);
      if (!retryJobs) recordLanguageStats(session, collectedGroups);
      const groups = retryJobs
        ? collectedGroups
        : collectedGroups.filter(isJapaneseGroup);
      const texts = retryJobs
        ? retryJobs.map((job) => job.text)
        : groups.map((group) => group.text);
      if (!incremental) platform.resetRemoteLog(activeScope);
      const batchFailures = [];
      session.completed = 0;
      session.total = texts.length;
      render();
      const analyses = texts.length > 0
        ? await reader.analyze(
          texts,
          {
            incremental: incremental || Boolean(retryJobs),
            scope: activeScope,
            signal: abortController.signal,
            onProgress(progress) {
              session.completed = progress.completed;
              session.total = progress.total;
              render();
            },
            onFragmentFailure(failure) {
              batchFailures.push(failure);
            },
          },
        )
        : [];
      const shiftedAnalyses = retryJobs
        ? shiftRetryAnalyses(analyses, retryJobs)
        : analyses;
      failedJobs.push(...createFailedJobs(batchFailures, groups, retryJobs));
      session.failedFragments = failedJobs.length;
      pauseObserver();
      let applied;
      try {
        applied = page.apply(groups, shiftedAnalyses);
      } finally {
        resumeObserver();
      }
      session.annotatedCharacters += applied.characters;
      session.annotations += applied.annotations;
      session.lastDurationMs = Math.round(runtime.now() - startedAt);
      session.status = failedJobs.length > 0 ? "已完成，有失败片段" : "已完成";
      enabled = true;
    } catch (error) {
      if (error.name !== "AbortError") throw error;
      session.status = "已取消";
    } finally {
      running = false;
      abortController = null;
      render();
      if (dirtyRoots.size > 0) scheduleChangeProcessing();
    }
  }

  function disableAnnotations() {
    pauseObserver();
    cancelMutationTask();
    try {
      page.remove();
    } finally {
      resumeObserver();
    }
    dirtyRoots.clear();
    failedJobs = [];
    session.failedFragments = 0;
    enabled = false;
    session.status = "已撤销";
    session.annotatedCharacters = 0;
    session.annotations = 0;
    session.otherLanguageRanges = 0;
    session.ambiguousRanges = 0;
    render();
  }

  function reportFailure(error) {
    running = false;
    session.status = "失败";
    resumeObserver();
    if (enabled && dirtyRoots.size > 0) scheduleChangeProcessing();
    render();
    platform.reportError(error);
  }

  async function toggle() {
    if (running) {
      session.status = "正在取消";
      abortController?.abort();
      render();
      return;
    }
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

  async function retryFailures() {
    if (running || failedJobs.length === 0) return;
    const jobs = failedJobs;
    failedJobs = [];
    try {
      await annotate({ incremental: true, retryJobs: jobs });
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
    platform.registerMenus({
      onClearCache: reader.clearCache,
      onRetryFailures: retryFailures,
      onVisibilityChange: refreshVisibility,
    });
    resumeObserver();
    try {
      await refreshVisibility();
      if (await platform.isAutoAnnotateEnabled()) await annotate();
    } catch (error) {
      reportFailure(error);
    }
  }

  return Object.freeze({ retryFailures, start, toggle });
}

function createBrowserRuntime({ window, document }) {
  return Object.freeze({
    now: () => window.performance.now(),
    createAbortController: () => new window.AbortController(),
    repeat: (callback, delay) => window.setInterval(callback, delay),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: (task) => window.clearTimeout(task),
    observeChanges(callback) {
      if (!document.body) return () => {};
      const dispatch = (mutations) => {
        const roots = collectMutationRoots(mutations);
        if (roots.length > 0) callback(roots);
      };
      const observer = new window.MutationObserver(dispatch);
      const stopNavigation = observeNavigation(window, () => callback([document.body]));
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      return () => {
        dispatch(observer.takeRecords());
        observer.disconnect();
        stopNavigation();
      };
    },
  });
}

function observeNavigation(window, callback) {
  const history = window.history;
  const originals = new Map();
  for (const method of ["pushState", "replaceState"]) {
    if (typeof history?.[method] !== "function") continue;
    const original = history[method];
    originals.set(method, original);
    history[method] = function patchedHistory(...args) {
      const result = original.apply(this, args);
      callback();
      return result;
    };
  }
  const listen = window.addEventListener?.bind(window);
  const unlisten = window.removeEventListener?.bind(window);
  listen?.("popstate", callback);
  listen?.("hashchange", callback);
  return () => {
    for (const [method, original] of originals) history[method] = original;
    unlisten?.("popstate", callback);
    unlisten?.("hashchange", callback);
  };
}

function shiftRetryAnalyses(analyses, jobs) {
  return analyses.map((annotations, index) =>
    annotations.map((annotation) => ({
      ...annotation,
      start: annotation.start + jobs[index].start,
      end: annotation.end + jobs[index].start,
    })),
  );
}

function createFailedJobs(failures, groups, retryJobs) {
  return failures.map((failure) => {
    const previous = retryJobs?.[failure.textIndex];
    return {
      group: groups[failure.textIndex],
      text: failure.text,
      start: (previous?.start || 0) + failure.start,
    };
  });
}

function enqueueDirtyRoot(dirtyRoots, root) {
  if (!root) return;
  for (const current of dirtyRoots) {
    if (current === root || (current.contains && current.contains(root))) return;
    if (root.contains && root.contains(current)) dirtyRoots.delete(current);
  }
  dirtyRoots.add(root);
}

function collectMutationRoots(mutations) {
  const roots = [];
  for (const mutation of mutations) {
    const root =
      mutation.type === "characterData"
        ? mutation.target.parentElement
        : mutation.target;
    if (!root || !root.isConnected || roots.includes(root)) continue;
    roots.push(root);
  }
  return roots.filter(
    (root) =>
      !roots.some(
        (candidate) => candidate !== root && candidate.contains(root),
      ),
  );
}

function createSessionStats() {
  return {
    status: "待标注",
    annotatedCharacters: 0,
    annotations: 0,
    lastDurationMs: 0,
    completed: 0,
    total: 0,
    failedFragments: 0,
    otherLanguageRanges: 0,
    ambiguousRanges: 0,
  };
}

function resetSessionStats(session) {
  session.annotatedCharacters = 0;
  session.annotations = 0;
  session.completed = 0;
  session.total = 0;
  session.failedFragments = 0;
  session.otherLanguageRanges = 0;
  session.ambiguousRanges = 0;
}

function isJapaneseGroup(group) {
  return group?.classification?.kind === LANGUAGE_KIND.JAPANESE;
}

function recordLanguageStats(session, groups) {
  for (const group of groups) {
    if (group?.classification?.kind === LANGUAGE_KIND.OTHER) {
      session.otherLanguageRanges += 1;
    }
    if (group?.classification?.kind === LANGUAGE_KIND.AMBIGUOUS) {
      session.ambiguousRanges += 1;
    }
  }
}

module.exports = Object.freeze({ createBrowserRuntime, createFuriganaApp });
