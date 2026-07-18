/**
 * [INPUT]: 依赖 reading/core.js、reading/cache.js、../text.js，以及 requestWords、getRemoteAccess、storage Adapter
 * [OUTPUT]: 对外提供 analyze(texts, options) 与 snapshot()，返回按输入顺序排列的读音区间和会话指标
 * [POS]: reading 的读音分析深 Module，以小 Interface 隐藏分块、两级缓存、授权、并发、降级、额度和统计
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const {
  annotationsFromYahooWords,
  requestWithInvalidParamsFallback,
} = require("./core");
const {
  createLruCache,
  createPersistentCache,
  createRollingQuota,
} = require("./cache");
const { hasKanji, splitByUtf8Bytes, utf8Length } = require("../text");

const DEFAULTS = Object.freeze({
  maxConcurrency: 3,
  responseCacheLimit: 300,
  rateLimit: 300,
  rateWindowMs: 60_000,
});

function createReadingEngine({
  requestWords,
  getRemoteAccess,
  storage,
  onSkipped = () => {},
  maxConcurrency = DEFAULTS.maxConcurrency,
  responseCacheLimit = DEFAULTS.responseCacheLimit,
  rateLimit = DEFAULTS.rateLimit,
  rateWindowMs = DEFAULTS.rateWindowMs,
}) {
  if (typeof requestWords !== "function" || typeof getRemoteAccess !== "function") {
    throw new TypeError("读音分析需要 requestWords 与 getRemoteAccess Adapter");
  }

  const memoryCache = createLruCache(responseCacheLimit);
  const persistentCache = createPersistentCache(storage);
  const quota = createRollingQuota(rateLimit, rateWindowMs);
  const metrics = createMetrics();

  async function analyze(texts, { incremental = false } = {}) {
    if (!incremental) resetPageMetrics(metrics);
    let remoteAccessPromise;
    const resolveRemoteAccess = async () => {
      remoteAccessPromise ||= Promise.resolve(getRemoteAccess());
      const appId = await remoteAccessPromise;
      if (!appId) throw new Error("未缓存文本需要 Yahoo Client ID");
      return appId;
    };
    const requestCached = (text) =>
      readThroughCaches(text, resolveRemoteAccess, {
        memoryCache,
        persistentCache,
        quota,
        metrics,
        requestWords,
      });
    return mapWithConcurrency(texts, 1, (text) =>
      analyzeText(text, requestCached, { maxConcurrency, metrics, onSkipped }),
    );
  }

  function snapshot() {
    return {
      metrics: { ...metrics },
      quota: quota.snapshot(),
    };
  }

  return Object.freeze({ analyze, snapshot });
}

async function readThroughCaches(text, resolveRemoteAccess, dependencies) {
  const {
    memoryCache,
    persistentCache,
    quota,
    metrics,
    requestWords,
  } = dependencies;
  if (memoryCache.has(text)) {
    metrics.memoryHits += 1;
    return memoryCache.get(text);
  }
  const storedWords = persistentCache.get(text);
  if (storedWords !== undefined) {
    metrics.storageHits += 1;
    memoryCache.set(text, storedWords);
    return storedWords;
  }

  metrics.cacheMisses += 1;
  const appId = await resolveRemoteAccess();
  quota.record();
  metrics.apiCalls += 1;
  const words = await requestWords(text, appId);
  memoryCache.set(text, words);
  persistentCache.set(text, words);
  return words;
}

async function analyzeText(text, requestCached, options) {
  const { maxConcurrency, metrics, onSkipped } = options;
  metrics.analyzedBytes += utf8Length(text);
  const chunks = splitByUtf8Bytes(text).filter((chunk) => hasKanji(chunk.text));
  const annotations = await mapWithConcurrency(chunks, maxConcurrency, async (chunk) => {
    const responses = await requestWithInvalidParamsFallback(chunk.text, requestCached);
    reportSkippedResponses(responses, metrics, onSkipped);
    return responses.flatMap((response) =>
      annotationsFromYahooWords(response.text, response.words).map((annotation) => ({
        ...annotation,
        start: annotation.start + response.start + chunk.start,
        end: annotation.end + response.start + chunk.start,
      })),
    );
  });
  return annotations.flat();
}

function reportSkippedResponses(responses, metrics, onSkipped) {
  for (const response of responses) {
    if (!response.skipped) continue;
    metrics.skippedFragments += 1;
    onSkipped({
      bytes: utf8Length(response.text),
      preview: response.text.slice(0, 80),
    });
  }
}

function createMetrics() {
  return {
    apiCalls: 0,
    memoryHits: 0,
    storageHits: 0,
    cacheMisses: 0,
    analyzedBytes: 0,
    skippedFragments: 0,
  };
}

function resetPageMetrics(metrics) {
  metrics.analyzedBytes = 0;
  metrics.skippedFragments = 0;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
}

module.exports = Object.freeze({ createReadingEngine });
