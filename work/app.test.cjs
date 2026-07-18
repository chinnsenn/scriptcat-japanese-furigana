/**
 * [INPUT]: 依赖 src/page/app.js Interface 与 page/reader/control/platform/runtime 内存 Adapter
 * [OUTPUT]: 验证注音会话启动、标注、增量处理、撤销、显隐和 Interface 调用顺序
 * [POS]: work 的 app Interface 回归测试，覆盖浏览器组合根之外的状态机 Implementation
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createFuriganaApp } = require("../src/page/app");

test("注音会话完成页面标注、处理动态正文并可完整撤销", async () => {
  const calls = { analyses: [], applies: [], removed: 0 };
  const runtime = createRuntime();
  const control = createControl();
  const page = {
    collect: () => [{ nodes: [{ data: "漢字" }], text: "漢字" }],
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
  assert.deepEqual(calls.analyses[0], {
    texts: ["漢字"],
    options: { incremental: false },
  });
  assert.equal(control.lastView.enabled, true);
  assert.equal(control.lastView.stats.annotatedCharacters, 2);

  runtime.triggerAdded();
  runtime.runScheduled();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.analyses[1].options.incremental, true);

  await app.toggle();
  assert.equal(calls.removed, 1);
  assert.equal(control.lastView.enabled, false);
  assert.equal(control.lastView.stats.status, "已撤销");
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
    isButtonForced: async () => false,
    registerMenus({ onVisibilityChange }) {
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
    schedule(callback) {
      scheduled = callback;
      return callback;
    },
    cancel(task) {
      if (scheduled === task) scheduled = null;
    },
    observeAdded(callback) {
      observer = callback;
      return () => {
        observer = null;
      };
    },
    triggerAdded() {
      observer();
    },
    runScheduled() {
      const callback = scheduled;
      scheduled = null;
      callback();
    },
  };
}

function createReadingSnapshot() {
  return {
    metrics: {
      apiCalls: 0,
      memoryHits: 0,
      storageHits: 0,
      cacheMisses: 0,
      analyzedBytes: 6,
      skippedFragments: 0,
    },
    quota: { limit: 300, used: 0, remaining: 300 },
  };
}
