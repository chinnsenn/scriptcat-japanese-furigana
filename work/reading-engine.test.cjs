/**
 * [INPUT]: 依赖 src/reading/engine.js Interface、内存 storage Adapter 与可控远程 Adapter
 * [OUTPUT]: 验证读音分析的懒授权、两级缓存、分块并发、顺序、统计和读音区间
 * [POS]: work 的 reading Interface 回归测试，覆盖 main.js 已不再了解的分析 Implementation
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createReadingEngine } = require("../src/reading/engine");

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

function createStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}
