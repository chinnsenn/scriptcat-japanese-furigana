/**
 * [INPUT]: 依赖 ../text.js 的 UTF-8 长度算法与可选的 localStorage 兼容接口
 * [OUTPUT]: 对外提供可清理的固定容量 LRU 与带内容校验的站点持久缓存
 * [POS]: reading 的缓存实现，向 engine.js 隐藏淘汰、过期、索引和存储异常处理
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const { utf8Length } = require("../text");

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
    clear() {
      if (!storage) return 0;
      const keys = readIndex();
      try {
        for (const key of keys) storage.removeItem(key);
        storage.removeItem(indexKey);
        return keys.length;
      } catch {
        return 0;
      }
    },
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
});
