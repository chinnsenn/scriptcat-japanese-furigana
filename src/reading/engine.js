/**
 * [INPUT]: 依赖 reading/core.js、cache、可取消 scheduler、../text.js 与远程授权 Adapter
 * [OUTPUT]: 对外提供带进度/取消/片段失败回调的 analyze、clearCache 与 snapshot
 * [POS]: reading 的读音分析深 Module，隐藏分块、缓存、授权、局部容错、瞬时重试、限流退避和统计
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const {
  annotationsFromYahooWords,
  requestWithInvalidParamsFallback,
} = require("./core");
const { createLruCache, createPersistentCache } = require("./cache");
const { createRequestScheduler } = require("./scheduler");
const { hasKanji, splitByUtf8Bytes, utf8Length } = require("../text");

const DEFAULTS = Object.freeze({
  maxConcurrency: 3,
  responseCacheLimit: 300,
  rateLimit: 300,
  rateWindowMs: 60_000,
  maxRateLimitRetries: 1,
  maxTransientRetries: 2,
  transientRetryBaseMs: 500,
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
  maxRateLimitRetries = DEFAULTS.maxRateLimitRetries,
  maxTransientRetries = DEFAULTS.maxTransientRetries,
  transientRetryBaseMs = DEFAULTS.transientRetryBaseMs,
  now = Date.now,
  wait,
}) {
  if (typeof requestWords !== "function" || typeof getRemoteAccess !== "function") {
    throw new TypeError("读音分析需要 requestWords 与 getRemoteAccess Adapter");
  }

  const metrics = createMetrics();
  const memoryCache = createLruCache(responseCacheLimit);
  const persistentCache = createPersistentCache(storage);
  const scheduler = createRequestScheduler(rateLimit, rateWindowMs, {
    now,
    wait,
    onWait: (delay) => {
      metrics.waitedMs += delay;
    },
  });

  async function analyze(texts, options = {}) {
    const {
      incremental = false,
      signal,
      onProgress = () => {},
      onFragmentFailure = () => {},
    } = options;
    if (!incremental) resetSessionMetrics(metrics);
    let remoteAccessPromise;
    const resolveRemoteAccess = async (text) => {
      remoteAccessPromise ||= Promise.resolve(getRemoteAccess({
        sample: text,
        scope: options.scope || "page",
      }));
      const appId = await remoteAccessPromise;
      if (!appId) throw new Error("未缓存文本需要 Yahoo Client ID");
      return appId;
    };
    const requestCached = (text) =>
      readThroughCaches(text, resolveRemoteAccess, {
        memoryCache,
        persistentCache,
        scheduler,
        metrics,
        requestWords,
        maxRateLimitRetries,
        rateWindowMs,
        maxTransientRetries,
        transientRetryBaseMs,
        signal,
      });
    let completed = 0;
    return mapWithConcurrency(texts, 1, async (text, textIndex) => {
      const annotations = await analyzeText(text, requestCached, {
        maxConcurrency,
        metrics,
        onSkipped,
        onFragmentFailure,
        signal,
        textIndex,
      });
      completed += 1;
      onProgress({ completed, total: texts.length });
      return annotations;
    }, signal);
  }

  function snapshot() {
    return {
      metrics: { ...metrics },
      quota: scheduler.snapshot(),
    };
  }

  function clearCache() {
    memoryCache.clear();
    return persistentCache.clear();
  }

  return Object.freeze({ analyze, clearCache, snapshot });
}

async function readThroughCaches(text, resolveRemoteAccess, dependencies) {
  const {
    memoryCache,
    persistentCache,
    scheduler,
    metrics,
    requestWords,
    maxRateLimitRetries,
    rateWindowMs,
    maxTransientRetries,
    transientRetryBaseMs,
    signal,
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
  const appId = await resolveRemoteAccess(text);
  const words = await requestRemote(text, appId, {
    scheduler,
    metrics,
    requestWords,
    maxRateLimitRetries,
    rateWindowMs,
    maxTransientRetries,
    transientRetryBaseMs,
    signal,
  });
  memoryCache.set(text, words);
  persistentCache.set(text, words);
  return words;
}

async function requestRemote(text, appId, options) {
  const {
    scheduler,
    metrics,
    requestWords,
    maxRateLimitRetries,
    rateWindowMs,
    maxTransientRetries,
    transientRetryBaseMs,
    signal,
  } = options;
  let rateLimitRetries = 0;
  let transientRetries = 0;
  while (true) {
    await scheduler.acquire(signal);
    metrics.apiCalls += 1;
    try {
      return await requestWords(text, appId, { signal });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      if (error.status === 429 && rateLimitRetries < maxRateLimitRetries) {
        rateLimitRetries += 1;
        metrics.rateLimitRetries += 1;
        scheduler.defer(error.retryAfterMs ?? rateWindowMs);
        continue;
      }
      if (error.transient && transientRetries < maxTransientRetries) {
        const delay = transientRetryBaseMs * 2 ** transientRetries;
        transientRetries += 1;
        metrics.transientRetries += 1;
        scheduler.defer(delay);
        continue;
      }
      throw error;
    }
  }
}

async function analyzeText(text, requestCached, options) {
  const {
    maxConcurrency,
    metrics,
    onSkipped,
    onFragmentFailure,
    signal,
    textIndex,
  } = options;
  metrics.analyzedBytes += utf8Length(text);
  const chunks = splitByUtf8Bytes(text).filter((chunk) => hasKanji(chunk.text));
  const annotations = await mapWithConcurrency(
    chunks,
    maxConcurrency,
    async (chunk) => {
      try {
        const responses = await requestWithInvalidParamsFallback(chunk.text, requestCached);
        reportSkippedResponses(responses, metrics, onSkipped);
        return responses.flatMap((response) =>
          annotationsFromYahooWords(response.text, response.words).map((annotation) => ({
            ...annotation,
            start: annotation.start + response.start + chunk.start,
            end: annotation.end + response.start + chunk.start,
          })),
        );
      } catch (error) {
        if (error.name === "AbortError") throw error;
        metrics.failedFragments += 1;
        onFragmentFailure({
          textIndex,
          text: chunk.text,
          start: chunk.start,
          end: chunk.end,
          error,
        });
        return [];
      }
    },
    signal,
  );
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
    rateLimitRetries: 0,
    transientRetries: 0,
    failedFragments: 0,
    waitedMs: 0,
  };
}

function resetSessionMetrics(metrics) {
  Object.assign(metrics, createMetrics());
}

async function mapWithConcurrency(items, limit, worker, signal) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      if (signal?.aborted) throw createAbortError();
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
}

function createAbortError() {
  const error = new Error("读音分析已取消");
  error.name = "AbortError";
  return error;
}

module.exports = Object.freeze({ createReadingEngine });
