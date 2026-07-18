/**
 * [INPUT]: 依赖 src/page/app.js Interface 与 page/reader/control/platform/runtime 内存 Adapter
 * [OUTPUT]: 验证日语区间请求过滤、跳过统计、注音会话、脏区增量处理、撤销与 Interface 调用顺序
 * [POS]: work 的 app Interface 回归测试，覆盖浏览器组合根之外的状态机 Implementation
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createBrowserRuntime, createFuriganaApp } = require("../src/page/app");
const { LANGUAGE_KIND } = require("../src/text");

test("注音会话完成页面标注、处理动态正文并可完整撤销", async () => {
  const calls = { analyses: [], applies: [], removed: 0 };
  const runtime = createRuntime();
  const control = createControl();
  const page = {
    collect: () => [languageGroup("漢字", { nodes: [{ data: "漢字" }] })],
    apply(groups, analyses) {
      calls.applies.push({ groups, analyses });
      return { annotations: 1, characters: 2 };
    },
    remove() {
      calls.removed += 1;
    },
    isJapanesePage: () => true,
  };
  const reader = {
    async analyze(texts, options) {
      calls.analyses.push({ texts, options });
      return [[{ start: 0, end: 2, base: "漢字", reading: "かんじ" }]];
    },
    snapshot: () => createReadingSnapshot(),
  };
  const platform = createPlatform();
  const app = createFuriganaApp({ page, reader, control, platform, runtime });

  await app.start();
  await app.toggle();

  assert.equal(control.hidden, false);
  assert.equal(calls.applies.length, 1);
  assert.deepEqual(calls.analyses[0].texts, ["漢字"]);
  assert.equal(calls.analyses[0].options.incremental, false);
  assert.equal(calls.analyses[0].options.signal.aborted, false);
  assert.equal(typeof calls.analyses[0].options.onProgress, "function");
  assert.equal(control.lastView.enabled, true);
  assert.equal(control.lastView.stats.annotatedCharacters, 2);

  runtime.triggerChange([{ id: "dynamic-root" }]);
  runtime.runScheduled();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.analyses[1].options.incremental, true);

  await app.toggle();
  assert.equal(calls.removed, 1);
  assert.equal(control.lastView.enabled, false);
  assert.equal(control.lastView.stats.status, "已撤销");
});

test("会话只分析日语区间并分别统计其他语言与歧义区间", async () => {
  const calls = { texts: [], groups: [] };
  const control = createControl();
  const app = createFuriganaApp({
    page: {
      collect: () => [
        languageGroup("東京へ行く"),
        languageGroup("中文段落", { kind: LANGUAGE_KIND.OTHER }),
        languageGroup("東京大学", { kind: LANGUAGE_KIND.AMBIGUOUS }),
      ],
      apply(groups) {
        calls.groups.push(...groups);
        return { annotations: 1, characters: 2 };
      },
      remove: () => {},
      isJapanesePage: () => true,
    },
    reader: {
      async analyze(texts) {
        calls.texts.push(...texts);
        return [[{ start: 0, end: 2, base: "東京", reading: "とうきょう" }]];
      },
      snapshot: () => createReadingSnapshot(),
    },
    control,
    platform: createPlatform(),
    runtime: createRuntime(),
  });

  await app.start();
  await app.toggle();

  assert.deepEqual(calls.texts, ["東京へ行く"]);
  assert.deepEqual(calls.groups.map((group) => group.text), ["東京へ行く"]);
  assert.equal(control.lastView.stats.otherLanguageRanges, 1);
  assert.equal(control.lastView.stats.ambiguousRanges, 1);
});

test("仅含其他语言和歧义区间时保持零分析与零标注", async () => {
  let analyses = 0;
  let appliedGroups;
  const control = createControl();
  const app = createFuriganaApp({
    page: {
      collect: () => [
        languageGroup("中文段落", { kind: LANGUAGE_KIND.OTHER }),
        languageGroup("東京大学", { kind: LANGUAGE_KIND.AMBIGUOUS }),
      ],
      apply(groups) {
        appliedGroups = groups;
        return { annotations: 0, characters: 0 };
      },
      remove: () => {},
      isJapanesePage: () => false,
    },
    reader: {
      analyze: async () => {
        analyses += 1;
        return [];
      },
      snapshot: () => createReadingSnapshot(),
    },
    control,
    platform: createPlatform({ isButtonForced: async () => true }),
    runtime: createRuntime(),
  });

  await app.start();
  await app.toggle();

  assert.equal(analyses, 0);
  assert.deepEqual(appliedGroups, []);
  assert.equal(control.lastView.stats.annotations, 0);
  assert.equal(control.lastView.stats.otherLanguageRanges, 1);
  assert.equal(control.lastView.stats.ambiguousRanges, 1);
});

test("分析期间发生的正文变化会在当前批次后继续增量处理", async () => {
  const runtime = createRuntime();
  const control = createControl();
  const changedRoot = { id: "changed-root" };
  const collectedRoots = [];
  let releaseFirstAnalysis;
  let analyses = 0;
  const firstAnalysis = new Promise((resolve) => {
    releaseFirstAnalysis = resolve;
  });
  const app = createFuriganaApp({
    page: {
      collect(options) {
        collectedRoots.push(options);
        return [languageGroup("漢字", { nodes: [{ data: "漢字" }] })];
      },
      apply: () => ({ annotations: 1, characters: 2 }),
      remove: () => {},
      isJapanesePage: () => true,
    },
    reader: {
      async analyze() {
        analyses += 1;
        if (analyses === 1) await firstAnalysis;
        return [[{ start: 0, end: 2, base: "漢字", reading: "かんじ" }]];
      },
      snapshot: () => createReadingSnapshot(),
    },
    control,
    platform: createPlatform(),
    runtime,
  });

  await app.start();
  const initial = app.toggle();
  await new Promise((resolve) => setImmediate(resolve));
  runtime.triggerChange([changedRoot]);
  releaseFirstAnalysis();
  await initial;
  runtime.runScheduled();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(analyses, 2);
  assert.deepEqual(collectedRoots[0], { scope: "main" });
  assert.deepEqual(collectedRoots[1], { scope: "main", root: changedRoot });
});

test("强制显示与页面语言共同决定浮动按钮显隐", async () => {
  let forced = false;
  const control = createControl();
  const platform = createPlatform({
    isButtonForced: async () => forced,
  });
  const app = createFuriganaApp({
    page: {
      collect: () => [],
      apply: () => ({ annotations: 0, characters: 0 }),
      remove: () => {},
      isJapanesePage: () => false,
    },
    reader: {
      analyze: async () => [],
      snapshot: () => createReadingSnapshot(),
    },
    control,
    platform,
    runtime: createRuntime(),
  });

  await app.start();
  assert.equal(control.hidden, true);

  forced = true;
  await platform.onVisibilityChange();
  assert.equal(control.hidden, false);
});

test("处理中再次切换会通过统一信号取消且不报告失败", async () => {
  const runtime = createRuntime();
  const control = createControl();
  const platform = createPlatform();
  let applies = 0;
  const app = createFuriganaApp({
    page: {
      collect: () => [languageGroup("漢字")],
      apply: () => {
        applies += 1;
        return { annotations: 1, characters: 2 };
      },
      remove: () => {},
      isJapanesePage: () => true,
    },
    reader: {
      analyze(_texts, { signal }) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("cancelled");
            error.name = "AbortError";
            reject(error);
          });
        });
      },
      snapshot: () => createReadingSnapshot(),
    },
    control,
    platform,
    runtime,
  });

  await app.start();
  const processing = app.toggle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(control.lastView.running, true);
  await app.toggle();
  await processing;

  assert.equal(applies, 0);
  assert.equal(control.lastView.running, false);
  assert.equal(control.lastView.stats.status, "已取消");
  assert.deepEqual(platform.errors, []);
});

test("局部失败保留成功结果并可按原段落偏移单独重试", async () => {
  const runtime = createRuntime();
  const control = createControl();
  const platform = createPlatform();
  const groups = [languageGroup("前東京後"), languageGroup("大阪")];
  const applies = [];
  let attempts = 0;
  const app = createFuriganaApp({
    page: {
      collect: () => groups,
      apply(appliedGroups, analyses) {
        applies.push({ appliedGroups, analyses });
        return { annotations: analyses.flat().length, characters: 2 };
      },
      remove: () => {},
      isJapanesePage: () => true,
    },
    reader: {
      async analyze(texts, options) {
        attempts += 1;
        if (attempts === 1) {
          options.onFragmentFailure({
            textIndex: 0,
            text: "東京",
            start: 1,
            end: 3,
            error: new Error("offline"),
          });
          options.onProgress({ completed: 2, total: 2 });
          return [[], [{ start: 0, end: 2, base: "大阪", reading: "おおさか" }]];
        }
        assert.deepEqual(texts, ["東京"]);
        options.onProgress({ completed: 1, total: 1 });
        return [[{ start: 0, end: 2, base: "東京", reading: "とうきょう" }]];
      },
      snapshot: () => createReadingSnapshot({ failedFragments: attempts === 1 ? 1 : 0 }),
    },
    control,
    platform,
    runtime,
  });

  await app.start();
  await app.toggle();
  assert.equal(control.lastView.enabled, true);
  assert.equal(applies[0].analyses[1][0].base, "大阪");

  await platform.onRetryFailures();
  assert.equal(applies.length, 2);
  assert.equal(applies[1].appliedGroups[0], groups[0]);
  assert.deepEqual(applies[1].analyses[0][0], {
    start: 1,
    end: 3,
    base: "東京",
    reading: "とうきょう",
  });
});

test("白名单站点启动后自动按默认范围进入注音会话", async () => {
  const runtime = createRuntime();
  const control = createControl();
  let applies = 0;
  const platform = createPlatform({
    isAutoAnnotateEnabled: async () => true,
  });
  const app = createFuriganaApp({
    page: {
      collect: () => [languageGroup("漢字")],
      apply: () => {
        applies += 1;
        return { annotations: 1, characters: 2 };
      },
      remove: () => {},
      isJapanesePage: () => true,
    },
    reader: {
      analyze: async () => [[{
        start: 0,
        end: 2,
        base: "漢字",
        reading: "かんじ",
      }]],
      clearCache: () => 0,
      snapshot: () => createReadingSnapshot(),
    },
    control,
    platform,
    runtime,
  });

  await app.start();

  assert.equal(applies, 1);
  assert.equal(control.lastView.enabled, true);
});

test("浏览器运行时观察节点增删、文本改写与 SPA 导航并在停止前排空记录", () => {
  const body = { id: "body" };
  const changedRoot = {
    id: "changed-root",
    isConnected: true,
    contains: () => false,
  };
  let observer;
  let observedOptions;
  const listeners = new Map();
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.records = [];
      observer = this;
    }
    observe(_target, options) {
      observedOptions = options;
    }
    takeRecords() {
      const records = this.records;
      this.records = [];
      return records;
    }
    disconnect() {}
  }
  const runtimeWindow = {
    MutationObserver,
    history: {
      pushState() {},
      replaceState() {},
    },
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
  const runtime = createBrowserRuntime({
    window: runtimeWindow,
    document: { body },
  });
  const batches = [];
  const stop = runtime.observeChanges((roots) => batches.push(roots));

  observer.callback([
    {
      type: "characterData",
      target: { parentElement: changedRoot },
    },
  ]);
  observer.records.push({ type: "childList", target: changedRoot });
  runtimeWindow.history.pushState({}, "", "/next");
  runtimeWindow.history.replaceState({}, "", "/replaced");
  listeners.get("popstate")();
  stop();

  assert.equal(observedOptions.characterData, true);
  assert.equal(observedOptions.childList, true);
  assert.deepEqual(batches, [[changedRoot], [body], [body], [body], [changedRoot]]);
});

function createControl() {
  return {
    hidden: null,
    lastView: null,
    render(view) {
      this.lastView = { ...view, stats: { ...view.stats }, quota: { ...view.quota } };
    },
    setHidden(hidden) {
      this.hidden = hidden;
    },
  };
}

function createPlatform(overrides = {}) {
  return {
    errors: [],
    onVisibilityChange: null,
    getDefaultScope: async () => "main",
    isAutoAnnotateEnabled: async () => false,
    isButtonForced: async () => false,
    recordRemoteRequest() {},
    resetRemoteLog() {},
    registerMenus({ onRetryFailures, onVisibilityChange }) {
      this.onRetryFailures = onRetryFailures;
      this.onVisibilityChange = onVisibilityChange;
    },
    reportError(error) {
      this.errors.push(error);
    },
    ...overrides,
  };
}

function createRuntime() {
  let now = 0;
  let observer = null;
  let scheduled = null;
  return {
    now: () => {
      now += 25;
      return now;
    },
    repeat: () => 1,
    createAbortController: () => new AbortController(),
    schedule(callback) {
      scheduled = callback;
      return callback;
    },
    cancel(task) {
      if (scheduled === task) scheduled = null;
    },
    observeChanges(callback) {
      observer = callback;
      return () => {
        observer = null;
      };
    },
    triggerChange(roots = []) {
      observer(roots);
    },
    runScheduled() {
      const callback = scheduled;
      scheduled = null;
      callback();
    },
  };
}

function createReadingSnapshot(overrides = {}) {
  return {
    metrics: {
      apiCalls: 0,
      memoryHits: 0,
      storageHits: 0,
      cacheMisses: 0,
      analyzedBytes: 6,
      skippedFragments: 0,
      rateLimitRetries: 0,
      transientRetries: 0,
      failedFragments: 0,
      waitedMs: 0,
      ...overrides,
    },
    quota: { limit: 300, used: 0, remaining: 300 },
  };
}

function languageGroup(text, { kind = LANGUAGE_KIND.JAPANESE, ...extra } = {}) {
  return {
    text,
    classification: { kind, reason: "test", tag: kind === LANGUAGE_KIND.JAPANESE ? "ja" : "" },
    ...extra,
  };
}
