/**
 * [INPUT]: 依赖 core.js 的 UTF-8 长度算法与可选的 localStorage 兼容接口
 * [OUTPUT]: 对外提供固定容量 LRU、滚动窗口额度和带内容校验的持久缓存
 * [POS]: src 的缓存深模块，向 main.js 隐藏淘汰、过期、索引和存储异常处理
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const { utf8Length } = require("./core");

const DEFAULT_PREFIX = "scriptcat-furigana-v2";
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

function createLruCache(maxEntries) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("maxEntries 必须是正整数");
  }
  const entries = new Map();
  return Object.freeze({
    get size() {
      return entries.size;
    },
    has(key) {
      return entries.has(key);
    },
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    clear() {
      entries.clear();
    },
  });
}

function createRollingQuota(limit, windowMs) {
  if (!Number.isInteger(limit) || limit < 1 || windowMs < 1) {
    throw new RangeError("额度与时间窗口必须为正数");
  }
  const timestamps = [];
  function prune(now) {
    const cutoff = now - windowMs;
    while (timestamps.length > 0 && timestamps[0] <= cutoff) timestamps.shift();
  }
  function snapshot(now = Date.now()) {
    prune(now);
    const used = timestamps.length;
    return { limit, used, remaining: Math.max(0, limit - used) };
  }
  return Object.freeze({
    record(now = Date.now()) {
      prune(now);
      timestamps.push(now);
      return snapshot(now);
    },
    snapshot,
  });
}

function hashText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}-${utf8Length(text)}`;
}

function createPersistentCache(storage, options = {}) {
  const prefix = options.prefix || DEFAULT_PREFIX;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const indexKey = `${prefix}:index`;
  const entryKey = (text) => `${prefix}:${hashText(text)}`;

  function readIndex() {
    try {
      const value = JSON.parse(storage.getItem(indexKey) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function writeIndex(keys) {
    storage.setItem(indexKey, JSON.stringify(keys));
  }

  function remove(key) {
    try {
      storage.removeItem(key);
      writeIndex(readIndex().filter((item) => item !== key));
    } catch {}
  }

  return Object.freeze({
    get(text, now = Date.now()) {
      if (!storage) return undefined;
      const key = entryKey(text);
      try {
        const entry = JSON.parse(storage.getItem(key) || "null");
        if (!entry || entry.text !== text || now - entry.createdAt >= maxAgeMs) {
          if (entry) remove(key);
          return undefined;
        }
        return Array.isArray(entry.words) ? entry.words : undefined;
      } catch {
        remove(key);
        return undefined;
      }
    },
    set(text, words, now = Date.now()) {
      if (!storage) return false;
      const key = entryKey(text);
      try {
        storage.setItem(key, JSON.stringify({ text, words, createdAt: now }));
        const keys = readIndex().filter((item) => item !== key);
        keys.push(key);
        while (keys.length > maxEntries) storage.removeItem(keys.shift());
        writeIndex(keys);
        return true;
      } catch {
        return false;
      }
    },
  });
}

module.exports = Object.freeze({
  createLruCache,
  createPersistentCache,
  createRollingQuota,
});
