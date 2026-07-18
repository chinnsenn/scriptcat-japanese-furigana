/**
 * [INPUT]: 依赖 core/cache/yahoo/dom/ui 模块、页面 DOM、ScriptCat GM API 与 Yahoo Client ID
 * [OUTPUT]: 启动日语页面识别、缓存优先注音、动态内容观察、配置菜单与可逆用户交互
 * [POS]: src 的浏览器组合根，只编排稳定模块接口并持有单一运行状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const {
  annotationsFromYahooWords,
  hasKanji,
  mapAnnotationsToNodes,
  requestWithInvalidParamsFallback,
  splitByUtf8Bytes,
  utf8Length,
} = require("./core");
const {
  createLruCache,
  createPersistentCache,
  createRollingQuota,
} = require("./cache");
const { createYahooAdapter } = require("./yahoo");
const { createDomAdapter } = require("./dom");
const { createFloatingUi } = require("./ui");

const API_RATE_LIMIT = 300;
const API_RATE_WINDOW_MS = 60_000;
const MAX_CONCURRENCY = 3;
const RESPONSE_CACHE_LIMIT = 300;
const UI_HOST_ID = "scriptcat-japanese-furigana-ui";
const RUBY_ATTRIBUTE = "data-scriptcat-furigana";
const BLOCK_SELECTOR =
  "p,li,dd,dt,blockquote,figcaption,h1,h2,h3,h4,h5,h6,td,th";
const SKIP_SELECTOR =
  "script,style,noscript,textarea,input,button,select,option,code,pre,ruby,rt,rp,svg,canvas,[contenteditable='true'],[aria-hidden='true']";
const STORAGE_KEYS = Object.freeze({
  appId: "yahooClientId",
  privacyAccepted: "privacyAccepted",
  forceButton: "forceButton",
  buttonPosition: "buttonPosition",
});

if (typeof document !== "undefined" && typeof window !== "undefined") start();

function start() {
  let enabled = false;
  let running = false;
  let observer = null;
  let mutationTimer = null;

  const responseCache = createLruCache(RESPONSE_CACHE_LIMIT);
  const apiQuota = createRollingQuota(API_RATE_LIMIT, API_RATE_WINDOW_MS);
  const persistentCache = createPersistentCache(readPageStorage());
  const stats = createStats();
  const dom = createDomAdapter({
    document,
    window,
    blockSelector: BLOCK_SELECTOR,
    skipSelector: SKIP_SELECTOR,
    rubyAttribute: RUBY_ATTRIBUTE,
  });
  const ui = createFloatingUi({
    document,
    window,
    hostId: UI_HOST_ID,
    loadPosition: (fallback) => getStoredValue(STORAGE_KEYS.buttonPosition, fallback),
    savePosition: (position) => setStoredValue(STORAGE_KEYS.buttonPosition, position),
    onToggle: toggleAnnotations,
    onWarning: (error) =>
      console.warn("[日语网页汉字注音] 按钮位置处理失败", error),
  });
  const yahoo = createYahooAdapter({
    request: GM_xmlhttpRequest,
    onRequest() {
      apiQuota.record();
      stats.apiCalls += 1;
      render();
    },
  });

  function render() {
    ui.render({ enabled, running, stats, quota: apiQuota.snapshot() });
  }

  function disconnectObserver() {
    if (observer) observer.disconnect();
    if (mutationTimer) window.clearTimeout(mutationTimer);
    mutationTimer = null;
  }

  function connectObserver() {
    disconnectObserver();
    observer = new window.MutationObserver((mutations) => {
      const hasAddedContent = mutations.some(
        (mutation) => mutation.addedNodes.length > 0,
      );
      if (!hasAddedContent || running || !enabled) return;
      mutationTimer = window.setTimeout(() => {
        annotatePage({ incremental: true }).catch(reportError);
      }, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function analyzeGroup(group, getAppId) {
    const chunks = splitByUtf8Bytes(group.text).filter((chunk) =>
      hasKanji(chunk.text),
    );
    stats.analyzedBytes += utf8Length(group.text);

    async function requestCached(text) {
      if (responseCache.has(text)) {
        stats.memoryHits += 1;
        render();
        return responseCache.get(text);
      }
      const storedWords = persistentCache.get(text);
      if (storedWords !== undefined) {
        stats.storageHits += 1;
        responseCache.set(text, storedWords);
        render();
        return storedWords;
      }
      stats.cacheMisses += 1;
      render();
      const appId = await getAppId();
      const words = await yahoo.request(text, appId);
      responseCache.set(text, words);
      persistentCache.set(text, words);
      return words;
    }

    const results = await mapWithConcurrency(
      chunks,
      MAX_CONCURRENCY,
      async (chunk) => analyzeChunk(chunk, requestCached),
    );
    return mapAnnotationsToNodes(group.nodes, results.flat());
  }

  async function analyzeChunk(chunk, requestCached) {
    const responses = await requestWithInvalidParamsFallback(
      chunk.text,
      requestCached,
    );
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
    const startedAt = window.performance.now();
    if (!incremental) resetAnnotationStats(stats);
    running = true;
    stats.status = "正在分析";
    disconnectObserver();
    render();
    try {
      const groups = dom.collect(document.body);
      const operationSets = await mapWithConcurrency(groups, 1, (group) =>
        analyzeGroup(group, getAppId),
      );
      const applied = dom.apply(operationSets.flat());
      stats.annotatedCharacters += applied.characters;
      stats.annotations += applied.annotations;
      stats.lastDurationMs = Math.round(window.performance.now() - startedAt);
      stats.status = "已完成";
      enabled = true;
      connectObserver();
    } finally {
      running = false;
      render();
    }
  }

  function disableAnnotations() {
    disconnectObserver();
    dom.remove();
    enabled = false;
    stats.status = "已撤销";
    stats.annotatedCharacters = 0;
    stats.annotations = 0;
    render();
  }

  function toggleAnnotations() {
    if (enabled) {
      disableAnnotations();
      return;
    }
    annotatePage().catch(reportError);
  }

  function reportError(error) {
    console.error("[日语网页汉字注音]", error);
    running = false;
    stats.status = "失败";
    render();
    window.alert(`注音失败：${error.message || String(error)}`);
  }

  async function configureAppId() {
    const current = await getStoredValue(STORAGE_KEYS.appId, "");
    const next = window.prompt(
      "请输入 Yahoo! JAPAN Developer Network Client ID",
      current,
    );
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

  async function refreshVisibility() {
    const forceButton = await getStoredValue(STORAGE_KEYS.forceButton, false);
    ui.setHidden(!(forceButton || dom.isJapanesePage()));
  }

  function registerMenus() {
    if (typeof GM_registerMenuCommand !== "function") return;
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

  render();
  window.setInterval(render, 1_000);
  registerMenus();
  refreshVisibility().catch(reportError);
}

function createStats() {
  return {
    status: "待标注",
    annotatedCharacters: 0,
    annotations: 0,
    apiCalls: 0,
    memoryHits: 0,
    storageHits: 0,
    cacheMisses: 0,
    analyzedBytes: 0,
    skippedFragments: 0,
    lastDurationMs: 0,
  };
}

function resetAnnotationStats(stats) {
  stats.annotatedCharacters = 0;
  stats.annotations = 0;
  stats.analyzedBytes = 0;
  stats.skippedFragments = 0;
}

function readPageStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function getStoredValue(key, fallback) {
  if (typeof GM_getValue !== "function") return fallback;
  return Promise.resolve(GM_getValue(key, fallback));
}

async function setStoredValue(key, value) {
  if (typeof GM_setValue !== "function") return;
  await Promise.resolve(GM_setValue(key, value));
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
