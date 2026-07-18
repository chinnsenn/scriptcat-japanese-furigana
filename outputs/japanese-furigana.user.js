// ==UserScript==
// @name         日语网页汉字注音
// @namespace    https://scriptcat.org/
// @version      0.2.1
// @description  识别日语页面并使用上下文相关读音为汉字添加 ruby 注音
// @author       Codex
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      jlp.yahooapis.jp
// ==/UserScript==
/**
 * [INPUT]: 依赖页面 DOM、ScriptCat GM_* API 与 Yahoo! JAPAN ルビ振り API
 * [OUTPUT]: 对外提供日语页面识别、localStorage 读音缓存、自适应 Yahoo 请求、可拖拽吸边按钮、悬浮统计、ruby 注音与动态页面增量处理
 * [POS]: outputs 的核心可安装脚本，README 说明其配置方式，work 测试其纯逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(function japaneseFuriganaUserscript() {
  "use strict";
  // --- 常量 ------------------------------------------------------------------
  const API_URL = "https://jlp.yahooapis.jp/jsonrpc";
  const API_METHOD = "jlp.furiganaservice.furigana";
  const API_CHUNK_BYTES = 3000;
  const API_RATE_LIMIT = 300;
  const API_RATE_WINDOW_MS = 60_000;
  const MAX_CONCURRENCY = 3;
  const RESPONSE_CACHE_LIMIT = 300;
  const STORAGE_CACHE_LIMIT = 200;
  const STORAGE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const STORAGE_CACHE_PREFIX = "scriptcat-furigana-v2";
  const UI_HOST_ID = "scriptcat-japanese-furigana-ui";
  const RUBY_ATTRIBUTE = "data-scriptcat-furigana";
  const BLOCK_SELECTOR = "p,li,dd,dt,blockquote,figcaption,h1,h2,h3,h4,h5,h6,td,th";
  const SKIP_SELECTOR = "script,style,noscript,textarea,input,button,select,option,code,pre,ruby,rt,rp,svg,canvas,[contenteditable='true'],[aria-hidden='true']";
  const STORAGE_KEYS = Object.freeze({ appId: "yahooClientId", privacyAccepted: "privacyAccepted", forceButton: "forceButton", buttonPosition: "buttonPosition" });
  const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
  const KANJI_RE = /\p{Script=Han}/u;
  const LETTER_RE = /[\p{L}]/gu;
  const SENTENCE_BREAK_RE = /[。！？!?\n]/u;
  // --- 纯逻辑：识别、分块与结果对齐 ------------------------------------------
  function hasKanji(text) { return KANJI_RE.test(text); }
  function isJapaneseText(text) {
    const kanaCount = (text.match(KANA_RE) || []).length;
    const letterCount = (text.match(LETTER_RE) || []).length;
    return kanaCount >= 20 && kanaCount / Math.max(letterCount, 1) >= 0.05;
  }
  function utf8Length(text) { return new TextEncoder().encode(text).length; }
  function splitByUtf8Bytes(text, maxBytes = API_CHUNK_BYTES) {
    if (!text) return [];
    if (maxBytes < 4) throw new RangeError("maxBytes 必须至少为 4");
    const chunks = [];
    let start = 0;
    while (start < text.length) {
      let end = start;
      let bytes = 0;
      let lastSentenceBreak = -1;
      while (end < text.length) {
        const codePoint = text.codePointAt(end);
        const character = String.fromCodePoint(codePoint);
        const characterBytes = utf8Length(character);
        if (bytes + characterBytes > maxBytes) break;
        bytes += characterBytes;
        end += character.length;
        if (SENTENCE_BREAK_RE.test(character)) lastSentenceBreak = end;
      }
      if (end === start) {
        const codePoint = text.codePointAt(start);
        end += String.fromCodePoint(codePoint).length;
      } else if (end < text.length && lastSentenceBreak > start) {
        end = lastSentenceBreak;
      }
      chunks.push({ text: text.slice(start, end), start, end });
      start = end;
    }
    return chunks;
  }
  function locateSurface(text, surface, cursor) {
    if (!surface) return -1;
    if (text.startsWith(surface, cursor)) return cursor;
    return text.indexOf(surface, cursor);
  }
  function appendWordAnnotations(output, word, wordStart) {
    const surface = word && typeof word.surface === "string" ? word.surface : "";
    const subwords = Array.isArray(word && word.subword) ? word.subword : [];
    if (subwords.length > 0) {
      let cursor = 0;
      for (const subword of subwords) {
        const subSurface = typeof subword.surface === "string" ? subword.surface : "";
        const subStart = locateSurface(surface, subSurface, cursor);
        if (subStart < 0) continue;
        appendWordAnnotations(output, subword, wordStart + subStart);
        cursor = subStart + subSurface.length;
      }
      return;
    }
    if (!hasKanji(surface) || typeof word.furigana !== "string" || !word.furigana) {
      return;
    }
    output.push({
      start: wordStart,
      end: wordStart + surface.length,
      base: surface,
      reading: word.furigana,
    });
  }
  function annotationsFromYahooWords(text, words) {
    const annotations = [];
    let cursor = 0;
    for (const word of Array.isArray(words) ? words : []) {
      const surface = word && typeof word.surface === "string" ? word.surface : "";
      const wordStart = locateSurface(text, surface, cursor);
      if (wordStart < 0) continue;
      appendWordAnnotations(annotations, word, wordStart);
      cursor = wordStart + surface.length;
    }
    return annotations.filter(
      (annotation) => annotation.start >= 0 && annotation.end <= text.length,
    );
  }
  function buildYahooRequest(appId, text) {
    const payload = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      jsonrpc: "2.0",
      method: API_METHOD,
      params: { q: text, grade: 1 },
    };
    return {
      method: "POST",
      url: `${API_URL}?appid=${encodeURIComponent(appId)}`,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
    };
  }
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
        if (entries.size > maxEntries) {
          entries.delete(entries.keys().next().value);
        }
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
    const prefix = options.prefix || STORAGE_CACHE_PREFIX;
    const maxEntries = options.maxEntries ?? STORAGE_CACHE_LIMIT;
    const maxAgeMs = options.maxAgeMs ?? STORAGE_CACHE_MAX_AGE_MS;
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
  function formatButtonLabel(active) { return active ? "已完成标注" : "标注读音"; }
  function calculateDockPosition({ left, top, width, height, viewportWidth, viewportHeight, margin = 12 }) {
    const maxLeft = Math.max(margin, viewportWidth - width - margin), maxTop = Math.max(margin, viewportHeight - height - margin);
    const x = Math.min(maxLeft, Math.max(margin, left)), y = Math.min(maxTop, Math.max(margin, top));
    const distances = { left: x - margin, right: maxLeft - x, top: y - margin, bottom: maxTop - y };
    const edge = Object.keys(distances).reduce((best, item) => distances[item] < distances[best] ? item : best);
    const vertical = edge === "left" || edge === "right";
    const snappedLeft = edge === "left" ? margin : edge === "right" ? maxLeft : x, snappedTop = edge === "top" ? margin : edge === "bottom" ? maxTop : y;
    const span = vertical ? maxTop - margin : maxLeft - margin, offset = vertical ? snappedTop - margin : snappedLeft - margin;
    return { edge, left: snappedLeft, top: snappedTop, ratio: span > 0 ? offset / span : 0 };
  }
  function isInvalidParamsError(error) {
    return Boolean(error && (error.code === -32602 || /Invalid params/i.test(String(error.message || ""))));
  }
  async function requestWithInvalidParamsFallback(text, request, options = {}, depth = 0) {
    const minimumBytes = options.minimumBytes ?? 96;
    const maxDepth = options.maxDepth ?? 8;
    try {
      const words = await request(text);
      return [{ text, start: 0, words, skipped: false }];
    } catch (error) {
      if (!isInvalidParamsError(error)) throw error;
      if (utf8Length(text) <= minimumBytes || depth >= maxDepth) {
        return [{ text, start: 0, words: [], skipped: true, error }];
      }
      const halfBytes = Math.max(minimumBytes, Math.ceil(utf8Length(text) / 2));
      const pieces = splitByUtf8Bytes(text, halfBytes);
      if (pieces.length < 2) return [{ text, start: 0, words: [], skipped: true, error }];
      const responses = [];
      for (const piece of pieces) {
        const nested = await requestWithInvalidParamsFallback(piece.text, request, options, depth + 1);
        responses.push(...nested.map((response) => ({ ...response, start: response.start + piece.start })));
      }
      return responses;
    }
  }
  function mapAnnotationsToNodes(nodes, annotations) {
    const ranges = [];
    let cursor = 0;
    for (const node of nodes) {
      const start = cursor;
      const end = start + node.data.length;
      ranges.push({ node, start, end });
      cursor = end;
    }
    const operations = [];
    for (const annotation of annotations) {
      const range = ranges.find(
        (candidate) =>
          annotation.start >= candidate.start && annotation.end <= candidate.end,
      );
      if (!range) continue;
      operations.push({
        node: range.node,
        start: annotation.start - range.start,
        end: annotation.end - range.start,
        base: annotation.base,
        reading: annotation.reading,
      });
    }
    return operations;
  }
  const TEST_API = Object.freeze({
    annotationsFromYahooWords,
    buildYahooRequest,
    calculateDockPosition,
    createLruCache,
    createPersistentCache,
    createRollingQuota,
    formatButtonLabel,
    hasKanji,
    isJapaneseText,
    mapAnnotationsToNodes,
    requestWithInvalidParamsFallback,
    splitByUtf8Bytes,
    utf8Length,
  });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = TEST_API;
  }
  if (typeof document === "undefined" || typeof window === "undefined") return;
  // --- DOM：采集、映射与可逆标注 ---------------------------------------------
  function isElementVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  }
  function isEligibleTextNode(node) {
    const parent = node.parentElement;
    if (!parent || !node.data.trim()) return false;
    if (parent.closest(SKIP_SELECTOR)) return false;
    if (parent.closest(`[${RUBY_ATTRIBUTE}]`)) return false;
    return isElementVisible(parent);
  }
  function collectTextGroups(root = document.body) {
    if (!root) return [];
    const nodeFilter = document.defaultView.NodeFilter;
    const walker = document.createTreeWalker(root, nodeFilter.SHOW_TEXT);
    const groups = new Map();
    let node = walker.nextNode();
    while (node) {
      if (isEligibleTextNode(node)) {
        const owner = node.parentElement.closest(BLOCK_SELECTOR) || node.parentElement;
        const nodes = groups.get(owner) || [];
        nodes.push(node);
        groups.set(owner, nodes);
      }
      node = walker.nextNode();
    }
    return Array.from(groups.values())
      .map((nodes) => ({ nodes, text: nodes.map((item) => item.data).join("") }))
      .filter((group) => hasKanji(group.text));
  }
  function createRuby(base, reading) {
    const ruby = document.createElement("ruby");
    const rb = document.createElement("rb");
    const rt = document.createElement("rt");
    ruby.setAttribute(RUBY_ATTRIBUTE, "");
    ruby.title = reading;
    rb.textContent = base;
    rt.textContent = reading;
    ruby.append(rb, rt);
    return ruby;
  }
  function applyOperations(operations) {
    const byNode = new Map();
    for (const operation of operations) {
      const entries = byNode.get(operation.node) || [];
      entries.push(operation);
      byNode.set(operation.node, entries);
    }
    let annotations = 0;
    let characters = 0;
    for (const [node, entries] of byNode) {
      entries.sort((left, right) => right.start - left.start);
      for (const entry of entries) {
        if (!node.isConnected || entry.start < 0 || entry.end > node.data.length) continue;
        if (entry.start >= entry.end) continue;
        if (node.data.slice(entry.start, entry.end) !== entry.base) continue;
        node.splitText(entry.end);
        const target = node.splitText(entry.start);
        target.replaceWith(createRuby(entry.base, entry.reading));
        annotations += 1;
        characters += Array.from(entry.base).filter((character) => hasKanji(character)).length;
      }
    }
    return { annotations, characters };
  }
  function removeAnnotations() {
    const parents = new Set();
    const rubies = document.querySelectorAll(`ruby[${RUBY_ATTRIBUTE}]`);
    for (const ruby of rubies) {
      const rb = Array.from(ruby.children).find((child) => child.tagName === "RB");
      const parent = ruby.parentNode;
      ruby.replaceWith(document.createTextNode(rb ? rb.textContent : ""));
      if (parent) parents.add(parent);
    }
    for (const parent of parents) parent.normalize();
    return rubies.length;
  }
  function sampleVisibleText(limit = 6000) {
    if (!document.body) return "";
    const walker = document.createTreeWalker(
      document.body,
      document.defaultView.NodeFilter.SHOW_TEXT,
    );
    let output = "";
    let node = walker.nextNode();
    while (node && output.length < limit) {
      if (isEligibleTextNode(node)) output += node.data;
      node = walker.nextNode();
    }
    return output.slice(0, limit);
  }
  function isJapanesePage() {
    const language = document.documentElement.lang.toLowerCase();
    return language === "ja" || language.startsWith("ja-") || isJapaneseText(sampleVisibleText());
  }
  // --- ScriptCat 与 Yahoo API -------------------------------------------------
  async function getStoredValue(key, fallback) {
    if (typeof GM_getValue !== "function") return fallback;
    return Promise.resolve(GM_getValue(key, fallback));
  }
  async function setStoredValue(key, value) {
    if (typeof GM_setValue !== "function") return;
    await Promise.resolve(GM_setValue(key, value));
  }
  function requestYahooFurigana(text, appId) {
    const request = buildYahooRequest(appId, text);
    apiQuota.record();
    stats.apiCalls += 1;
    renderStats();
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        ...request,
        responseType: "json",
        timeout: 20000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            const responseBody =
              response.responseText ||
              (response.response ? JSON.stringify(response.response) : "");
            const detail = responseBody.slice(0, 500);
            reject(
              new Error(
                `Yahoo API 返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`,
              ),
            );
            return;
          }
          try {
            const body = response.response || JSON.parse(response.responseText);
            if (body.error) {
              const yahooError = new Error(body.error.message || "Yahoo API 返回错误");
              yahooError.code = body.error.code;
              yahooError.data = body.error.data;
              reject(yahooError);
              return;
            }
            resolve(body.result && Array.isArray(body.result.word) ? body.result.word : []);
          } catch (error) {
            reject(new Error(`Yahoo API 响应解析失败：${error.message}`));
          }
        },
        onerror(error) {
          reject(new Error(`Yahoo API 网络请求失败：${String(error)}`));
        },
        ontimeout() {
          reject(new Error("Yahoo API 请求超时"));
        },
      });
    });
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
  async function configureAppId() {
    const current = await getStoredValue(STORAGE_KEYS.appId, "");
    const next = window.prompt("请输入 Yahoo! JAPAN Developer Network Client ID", current);
    if (next === null) return current;
    const value = next.trim();
    await setStoredValue(STORAGE_KEYS.appId, value);
    window.alert(value ? "Client ID 已保存" : "Client ID 已清除");
    return value;
  }
  async function ensureRemoteAccess() {
    let appId = await getStoredValue(STORAGE_KEYS.appId, "");
    if (!appId) appId = await configureAppId();
    if (!appId) return "";
    const accepted = await getStoredValue(STORAGE_KEYS.privacyAccepted, false);
    if (accepted) return appId;
    const confirmed = window.confirm(
      "注音时会把当前页面的可见正文分段发送到 Yahoo! JAPAN ルビ振り API。是否继续？",
    );
    if (!confirmed) return "";
    await setStoredValue(STORAGE_KEYS.privacyAccepted, true);
    return appId;
  }
  // --- 控制器与界面 -----------------------------------------------------------
  let enabled = false, running = false, observer = null, mutationTimer = null;
  const responseCache = createLruCache(RESPONSE_CACHE_LIMIT);
  const apiQuota = createRollingQuota(API_RATE_LIMIT, API_RATE_WINDOW_MS);
  const pageStorage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  const persistentCache = createPersistentCache(pageStorage);
  const stats = {
    status: "待标注", annotatedCharacters: 0, annotations: 0,
    apiCalls: 0, memoryHits: 0, storageHits: 0, cacheMisses: 0,
    analyzedBytes: 0, skippedFragments: 0, lastDurationMs: 0,
  };
  function createInterface() {
    const host = document.createElement("div");
    host.id = UI_HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    const dock = document.createElement("div");
    const button = document.createElement("button");
    const panel = document.createElement("div");
    const values = {};
    style.textContent = `
      :host { all: initial; }
      .dock { position:fixed; right:12px; bottom:12px; z-index:2147483647; }
      button { width:104px; height:38px; padding:0 12px; touch-action:none; user-select:none; border:1px solid rgba(255,255,255,.22); border-radius:12px; color:#fff; background:#242424; box-shadow:0 8px 24px rgba(0,0,0,.24); font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; cursor:grab; }
      button:hover { background: #111; }
      .dock[data-dragging="true"] button { cursor:grabbing; }
      button:disabled { cursor: wait; opacity: .68; }
      button[data-active="true"] { background: #236746; }
      .stats { position:absolute; right:0; bottom:calc(100% + 8px); width:240px; padding:11px 13px; border:1px solid rgba(255,255,255,.12); border-radius:12px; color:#f7f7f7; background:rgba(24,24,24,.96); box-shadow:0 12px 34px rgba(0,0,0,.3); font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; opacity:0; transform:translateY(5px); pointer-events:none; transition:opacity .15s ease,transform .15s ease; }
      .dock[data-panel-y="below"] .stats { top:calc(100% + 8px); bottom:auto; }
      .dock[data-panel-x="right"] .stats { left:0; right:auto; }
      .dock[data-dragging="true"] .stats { opacity:0; }
      button:hover + .stats, button:focus-visible + .stats { opacity:1; transform:none; }
      .row { display:flex; justify-content:space-between; gap:16px; padding:3px 0; }
      .name { color:#aaa; } .value { color:#fff; text-align:right; }
    `;
    button.type = "button";
    button.dataset.testid = "scriptcat-furigana-toggle";
    dock.className = "dock";
    panel.className = "stats";
    panel.setAttribute("role", "tooltip");
    for (const [key, label] of Object.entries({ status: "状态", annotated: "已标注", quota: "API 额度", apiCalls: "API 调用", cacheHits: "缓存命中", cacheMisses: "缓存未命中", analyzed: "已分析文本", skipped: "异常片段", duration: "最近耗时" })) {
      const row = document.createElement("div");
      const name = document.createElement("span"), value = document.createElement("span");
      row.className = "row"; name.className = "name"; value.className = "value";
      name.textContent = label;
      row.append(name, value); panel.append(row);
      values[key] = value;
    }
    dock.append(button, panel);
    shadow.append(style, dock);
    document.documentElement.append(host);
    return { host, dock, button, values };
  }
  const ui = createInterface();
  let dockPosition = { edge: "right", ratio: 1 };
  let dragState = null;
  let suppressClickUntil = 0;
  function positionDock(position = dockPosition) {
    const margin = 12, width = ui.button.offsetWidth || 104, height = ui.button.offsetHeight || 38;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin), maxTop = Math.max(margin, window.innerHeight - height - margin);
    const ratio = Math.min(1, Math.max(0, Number(position.ratio) || 0));
    const left = position.edge === "left" ? margin : position.edge === "right" ? maxLeft : margin + ratio * (maxLeft - margin);
    const top = position.edge === "top" ? margin : position.edge === "bottom" ? maxTop : margin + ratio * (maxTop - margin);
    ui.dock.style.right = "auto"; ui.dock.style.bottom = "auto";
    ui.dock.style.left = `${Math.round(left)}px`; ui.dock.style.top = `${Math.round(top)}px`;
    ui.dock.dataset.panelX = left < 260 ? "right" : "left"; ui.dock.dataset.panelY = top < 260 ? "below" : "above";
  }
  async function restoreDockPosition() {
    const saved = await getStoredValue(STORAGE_KEYS.buttonPosition, dockPosition);
    if (saved && ["left", "right", "top", "bottom"].includes(saved.edge)) dockPosition = saved;
    positionDock();
  }
  function finishDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (dragState.moved) {
      const rect = ui.dock.getBoundingClientRect();
      dockPosition = calculateDockPosition({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
      positionDock();
      setStoredValue(STORAGE_KEYS.buttonPosition, dockPosition).catch((error) => console.warn("[日语网页汉字注音] 按钮位置保存失败", error));
      suppressClickUntil = performance.now() + 400;
    }
    dragState = null; delete ui.dock.dataset.dragging;
  }
  function renderStats() {
    const quota = apiQuota.snapshot();
    ui.values.status.textContent = stats.status;
    ui.values.annotated.textContent = `${stats.annotatedCharacters} 字 / ${stats.annotations} 处`;
    ui.values.quota.textContent = `${quota.remaining}/${quota.limit}（近 60 秒）`;
    ui.values.apiCalls.textContent = `${stats.apiCalls} 次（本页会话）`;
    ui.values.cacheHits.textContent = `内存 ${stats.memoryHits} / 本地 ${stats.storageHits}`;
    ui.values.cacheMisses.textContent = `${stats.cacheMisses} 次`;
    ui.values.analyzed.textContent = `${(stats.analyzedBytes / 1024).toFixed(1)} KB`;
    ui.values.skipped.textContent = `${stats.skippedFragments} 个`;
    ui.values.duration.textContent = `${stats.lastDurationMs} ms`;
  }
  function updateButton() {
    const label = formatButtonLabel(enabled);
    ui.button.textContent = label;
    ui.button.disabled = running;
    ui.button.dataset.active = String(enabled);
    ui.button.setAttribute("aria-label", enabled ? "已完成标注，点击移除读音" : "标注读音");
    renderStats();
  }
  updateButton();
  window.setInterval(renderStats, 1000);
  ui.button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = ui.dock.getBoundingClientRect();
    dragState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    ui.button.setPointerCapture(event.pointerId); ui.dock.dataset.dragging = "true";
  });
  ui.button.addEventListener("pointermove", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.x, dy = event.clientY - dragState.y;
    if (!dragState.moved && Math.hypot(dx, dy) < 4) return;
    dragState.moved = true; event.preventDefault();
    const left = Math.min(window.innerWidth - ui.dock.offsetWidth, Math.max(0, dragState.left + dx));
    const top = Math.min(window.innerHeight - ui.dock.offsetHeight, Math.max(0, dragState.top + dy));
    ui.dock.style.left = `${left}px`; ui.dock.style.top = `${top}px`;
    ui.dock.dataset.panelX = left < 260 ? "right" : "left"; ui.dock.dataset.panelY = top < 260 ? "below" : "above";
  });
  ui.button.addEventListener("pointerup", finishDrag);
  ui.button.addEventListener("pointercancel", finishDrag);
  window.addEventListener("resize", () => positionDock());
  restoreDockPosition().catch((error) => console.warn("[日语网页汉字注音] 按钮位置恢复失败", error));
  function disconnectObserver() {
    if (observer) observer.disconnect();
    if (mutationTimer) window.clearTimeout(mutationTimer);
    mutationTimer = null;
  }
  function connectObserver() {
    disconnectObserver();
    observer = new MutationObserver((mutations) => {
      const hasAddedContent = mutations.some((mutation) => mutation.addedNodes.length > 0);
      if (!hasAddedContent || running || !enabled) return;
      mutationTimer = window.setTimeout(() => {
        annotatePage({ incremental: true }).catch(reportError);
      }, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  async function analyzeGroup(group, getAppId) {
    const chunks = splitByUtf8Bytes(group.text).filter((chunk) => hasKanji(chunk.text));
    stats.analyzedBytes += utf8Length(group.text);
    async function requestCached(text) {
      if (responseCache.has(text)) {
        stats.memoryHits += 1;
        renderStats();
        return responseCache.get(text);
      }
      const storedWords = persistentCache.get(text);
      if (storedWords !== undefined) {
        stats.storageHits += 1;
        responseCache.set(text, storedWords);
        renderStats();
        return storedWords;
      }
      stats.cacheMisses += 1;
      renderStats();
      const appId = await getAppId();
      const words = await requestYahooFurigana(text, appId);
      responseCache.set(text, words);
      persistentCache.set(text, words);
      return words;
    }
    const results = await mapWithConcurrency(chunks, MAX_CONCURRENCY, async (chunk) => {
      const responses = await requestWithInvalidParamsFallback(chunk.text, requestCached);
      for (const response of responses) {
        if (!response.skipped) continue;
        stats.skippedFragments += 1;
        console.warn("[日语网页汉字注音] 跳过 Yahoo 无法解析的文本片段", {
          bytes: utf8Length(response.text),
          preview: response.text.slice(0, 80),
        });
      }
      return responses.flatMap((response) =>
        annotationsFromYahooWords(response.text, response.words).map((annotation) => ({
          ...annotation,
          start: annotation.start + response.start + chunk.start,
          end: annotation.end + response.start + chunk.start,
        })),
      );
    });
    return mapAnnotationsToNodes(group.nodes, results.flat());
  }
  async function annotatePage({ incremental = false } = {}) {
    if (running) return;
    let appIdPromise;
    const getAppId = async () => {
      appIdPromise ||= ensureRemoteAccess();
      const appId = await appIdPromise;
      if (!appId) throw new Error("未缓存文本需要 Yahoo Client ID");
      return appId;
    };
    const startedAt = performance.now();
    if (!incremental) {
      stats.annotatedCharacters = 0;
      stats.annotations = 0;
      stats.analyzedBytes = 0;
      stats.skippedFragments = 0;
    }
    running = true;
    stats.status = "正在分析";
    disconnectObserver();
    updateButton();
    try {
      const groups = collectTextGroups(document.body);
      const operationSets = await mapWithConcurrency(
        groups,
        1,
        (group) => analyzeGroup(group, getAppId),
      );
      const applied = applyOperations(operationSets.flat());
      stats.annotatedCharacters += applied.characters;
      stats.annotations += applied.annotations;
      stats.lastDurationMs = Math.round(performance.now() - startedAt);
      stats.status = "已完成";
      enabled = true;
      updateButton();
      connectObserver();
    } finally {
      running = false;
      updateButton();
    }
  }
  function disableAnnotations() {
    disconnectObserver();
    removeAnnotations();
    enabled = false;
    stats.status = "已撤销";
    stats.annotatedCharacters = 0;
    stats.annotations = 0;
    updateButton();
  }
  function reportError(error) {
    console.error("[日语网页汉字注音]", error);
    running = false; stats.status = "失败"; updateButton();
    window.alert(`注音失败：${error.message || String(error)}`);
  }
  ui.button.addEventListener("click", () => {
    if (performance.now() < suppressClickUntil || running) return;
    if (enabled) {
      disableAnnotations();
      return;
    }
    annotatePage().catch(reportError);
  });
  async function refreshVisibility() {
    const forceButton = await getStoredValue(STORAGE_KEYS.forceButton, false);
    ui.host.hidden = !(forceButton || isJapanesePage());
  }
  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("设置 Yahoo Client ID", () => {
      configureAppId().catch(reportError);
    });
    GM_registerMenuCommand("切换按钮强制显示", async () => {
      const current = await getStoredValue(STORAGE_KEYS.forceButton, false);
      await setStoredValue(STORAGE_KEYS.forceButton, !current);
      await refreshVisibility();
    });
    GM_registerMenuCommand("重置正文发送确认", async () => {
      await setStoredValue(STORAGE_KEYS.privacyAccepted, false);
      window.alert("正文发送确认已重置");
    });
  }
  refreshVisibility().catch(reportError);
})();
