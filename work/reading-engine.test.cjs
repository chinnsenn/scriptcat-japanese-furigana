/**
 * [INPUT]: 依赖 src/reading/engine.js Interface、内存 storage Adapter 与可控远程 Adapter
 * [OUTPUT]: 验证读音分析的懒授权、两级缓存、请求调度、429 重试、统计和读音区间
 * [POS]: work 的 reading Interface 回归测试，覆盖 main.js 已不再了解的分析 Implementation
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createReadingEngine } = require("../src/reading/engine");
const { createRequestScheduler } = require("../src/reading/scheduler");

test("相同文本依次命中内存与持久缓存，缓存命中保持零远程授权", async () => {
  const storage = createStorage();
  let remoteAccesses = 0;
  let requests = 0;
  const reader = createReadingEngine({
    storage,
    getRemoteAccess: async () => {
      remoteAccesses += 1;
      return "client-id";
    },
    requestWords: async (text) => {
      requests += 1;
      return [{ surface: text, furigana: "かんじ" }];
    },
  });

  const first = await reader.analyze(["漢字"]);
  const second = await reader.analyze(["漢字"], { incremental: true });

  assert.deepEqual(first, [
    [{ start: 0, end: 2, base: "漢字", reading: "かんじ" }],
  ]);
  assert.deepEqual(second, first);
  assert.equal(remoteAccesses, 1);
  assert.equal(requests, 1);
  assert.deepEqual(reader.snapshot().metrics, {
    apiCalls: 1,
    memoryHits: 1,
    storageHits: 0,
    cacheMisses: 1,
    analyzedBytes: 12,
    skippedFragments: 0,
    rateLimitRetries: 0,
    transientRetries: 0,
    failedFragments: 0,
    waitedMs: 0,
  });

  await reader.analyze(["漢字"]);
  assert.deepEqual(reader.snapshot().metrics, {
    apiCalls: 0,
    memoryHits: 1,
    storageHits: 0,
    cacheMisses: 0,
    analyzedBytes: 6,
    skippedFragments: 0,
    rateLimitRetries: 0,
    transientRetries: 0,
    failedFragments: 0,
    waitedMs: 0,
  });

  let restoredAccesses = 0;
  const restoredReader = createReadingEngine({
    storage,
    getRemoteAccess: async () => {
      restoredAccesses += 1;
      return "client-id";
    },
    requestWords: async () => {
      throw new Error("持久缓存命中时不应请求远程");
    },
  });
  assert.deepEqual(await restoredReader.analyze(["漢字"]), first);
  assert.equal(restoredAccesses, 0);
  assert.equal(restoredReader.snapshot().metrics.storageHits, 1);
});

test("请求调度器达到窗口上限后等待最早额度释放", async () => {
  let now = 0;
  const waits = [];
  const scheduler = createRequestScheduler(2, 100, {
    now: () => now,
    wait: async (delay) => {
      waits.push(delay);
      now += delay;
    },
  });

  await scheduler.acquire();
  await scheduler.acquire();
  await scheduler.acquire();

  assert.deepEqual(waits, [100]);
  assert.deepEqual(scheduler.snapshot(), { limit: 2, used: 1, remaining: 1 });
});

test("Yahoo 429 响应按建议等待时间重试并记录真实调用", async () => {
  let now = 0;
  const waits = [];
  let requests = 0;
  const reader = createReadingEngine({
    storage: null,
    rateWindowMs: 100,
    now: () => now,
    wait: async (delay) => {
      waits.push(delay);
      now += delay;
    },
    getRemoteAccess: async () => "client-id",
    requestWords: async (text) => {
      requests += 1;
      if (requests === 1) {
        const error = new Error("Too Many Requests");
        error.status = 429;
        error.retryAfterMs = 40;
        throw error;
      }
      return [{ surface: text, furigana: "かんじ" }];
    },
  });

  const result = await reader.analyze(["漢字"]);

  assert.equal(result[0][0].reading, "かんじ");
  assert.deepEqual(waits, [40]);
  assert.equal(reader.snapshot().metrics.apiCalls, 2);
  assert.equal(reader.snapshot().metrics.rateLimitRetries, 1);
});

test("一次读音分析只获取一次远程授权并限制分块并发", async () => {
  const longText = "漢字。".repeat(1_200);
  let remoteAccesses = 0;
  let active = 0;
  let peak = 0;
  let requests = 0;
  const reader = createReadingEngine({
    storage: null,
    maxConcurrency: 2,
    rateLimit: 20,
    getRemoteAccess: async () => {
      remoteAccesses += 1;
      return "client-id";
    },
    requestWords: async (text) => {
      requests += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return [{ surface: text, furigana: "よみ" }];
    },
  });

  const batches = await reader.analyze([longText, "東京"]);
  const snapshot = reader.snapshot();

  assert.equal(batches.length, 2);
  assert.ok(batches[0].length > 1);
  assert.deepEqual(batches[1], [
    { start: 0, end: 2, base: "東京", reading: "よみ" },
  ]);
  assert.equal(remoteAccesses, 1);
  assert.equal(peak, 2);
  assert.equal(snapshot.metrics.apiCalls, requests);
  assert.equal(snapshot.quota.remaining, 20 - requests);
});

test("瞬时错误指数退避两次后成功并累计等待与重试指标", async () => {
  let now = 0;
  const waits = [];
  let requests = 0;
  const reader = createReadingEngine({
    storage: null,
    transientRetryBaseMs: 10,
    now: () => now,
    wait: async (delay) => {
      waits.push(delay);
      now += delay;
    },
    getRemoteAccess: async () => "client-id",
    requestWords: async (text) => {
      requests += 1;
      if (requests <= 2) {
        const error = new Error("temporary outage");
        error.transient = true;
        throw error;
      }
      return [{ surface: text, furigana: "かんじ" }];
    },
  });

  const result = await reader.analyze(["漢字"]);

  assert.equal(result[0][0].reading, "かんじ");
  assert.deepEqual(waits, [10, 20]);
  assert.equal(reader.snapshot().metrics.transientRetries, 2);
  assert.equal(reader.snapshot().metrics.waitedMs, 30);
});

test("单个片段最终失败时保留其余结果并报告进度与可重试片段", async () => {
  const failures = [];
  const progress = [];
  const reader = createReadingEngine({
    storage: null,
    getRemoteAccess: async () => "client-id",
    requestWords: async (text) => {
      if (text === "失敗") throw new Error("permanent failure");
      return [{ surface: text, furigana: "せいこう" }];
    },
  });

  const result = await reader.analyze(["失敗", "成功"], {
    onFragmentFailure: (failure) => failures.push(failure),
    onProgress: (value) => progress.push(value),
  });

  assert.deepEqual(result[0], []);
  assert.equal(result[1][0].base, "成功");
  assert.equal(failures.length, 1);
  assert.deepEqual(
    { textIndex: failures[0].textIndex, text: failures[0].text, start: failures[0].start },
    { textIndex: 0, text: "失敗", start: 0 },
  );
  assert.deepEqual(progress, [
    { completed: 1, total: 2 },
    { completed: 2, total: 2 },
  ]);
  assert.equal(reader.snapshot().metrics.failedFragments, 1);
});

test("取消信号会立即中断 429 长等待", async () => {
  const controller = new AbortController();
  const reader = createReadingEngine({
    storage: null,
    getRemoteAccess: async () => "client-id",
    requestWords: async () => {
      const error = new Error("rate limited");
      error.status = 429;
      error.retryAfterMs = 10_000;
      throw error;
    },
  });

  const analysis = reader.analyze(["漢字"], { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(analysis, (error) => error.name === "AbortError");
});

test("清理读音缓存同时清空内存与当前站点持久条目", async () => {
  const storage = createStorage();
  let requests = 0;
  const contexts = [];
  const reader = createReadingEngine({
    storage,
    getRemoteAccess: async (context) => {
      contexts.push(context);
      return "client-id";
    },
    requestWords: async (text) => {
      requests += 1;
      return [{ surface: text, furigana: "かんじ" }];
    },
  });

  await reader.analyze(["漢字"], { scope: "main" });
  await reader.analyze(["漢字"], { incremental: true, scope: "main" });
  assert.equal(requests, 1);

  assert.equal(reader.clearCache(), 1);
  await reader.analyze(["漢字"], { incremental: true, scope: "main" });

  assert.equal(requests, 2);
  assert.deepEqual(contexts[0], { sample: "漢字", scope: "main" });
});

function createStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}
