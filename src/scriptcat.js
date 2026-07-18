/**
 * [INPUT]: 依赖浏览器 window 与 GM_getValue、GM_setValue、GM_registerMenuCommand Adapter
 * [OUTPUT]: 对外提供站点许可/白名单、范围、发送审计、缓存菜单、页面存储与错误反馈 Interface
 * [POS]: src 的 ScriptCat Adapter，集中用户脚本平台差异、站点隐私状态与交互式配置
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const STORAGE_KEYS = Object.freeze({
  appId: "yahooClientId",
  remoteAccessOrigins: "remoteAccessOrigins",
  forceButton: "forceButton",
  buttonPosition: "buttonPosition",
  defaultScope: "defaultScope",
  autoAnnotateOrigins: "autoAnnotateOrigins",
});

const SCOPE_LABELS = Object.freeze({
  selection: "选中文本",
  main: "正文区域",
  page: "整页",
});

function createScriptCatAdapter({ window, getValue, setValue, registerMenu }) {
  const remoteLog = { scope: "main", requests: [] };
  const read = (key, fallback) =>
    typeof getValue === "function"
      ? Promise.resolve(getValue(key, fallback))
      : Promise.resolve(fallback);
  const write = (key, value) =>
    typeof setValue === "function"
      ? Promise.resolve(setValue(key, value))
      : Promise.resolve();
  const readOriginList = (key) => readOriginListFrom(read, key);

  async function configureAppId() {
    const current = await read(STORAGE_KEYS.appId, "");
    const next = window.prompt(
      "请输入 Yahoo! JAPAN Developer Network Client ID",
      current,
    );
    if (next === null) return current;
    const value = next.trim();
    await write(STORAGE_KEYS.appId, value);
    window.alert(value ? "Client ID 已保存" : "Client ID 已清除");
    return value;
  }

  async function getRemoteAccess({ scope = "main", sample = "" } = {}) {
    let appId = await read(STORAGE_KEYS.appId, "");
    if (!appId) appId = await configureAppId();
    if (!appId) return "";
    const origin = currentOrigin(window);
    const acceptedOrigins = await readOrigins();
    if (acceptedOrigins.includes(origin)) return appId;
    const preview = compactPreview(sample);
    const confirmed = window.confirm(
      `允许 ${origin} 发送正文到 Yahoo! JAPAN ルビ振り API？\n范围：${SCOPE_LABELS[scope] || SCOPE_LABELS.main}\n首个未缓存片段：${sample.length} 字${preview ? `「${preview}」` : ""}`,
    );
    if (!confirmed) return "";
    await write(STORAGE_KEYS.remoteAccessOrigins, [...acceptedOrigins, origin]);
    return appId;
  }

  async function readOrigins() {
    return readOriginList(STORAGE_KEYS.remoteAccessOrigins);
  }

  function reportError(error) {
    console.error("[日语网页汉字注音]", error);
    window.alert(`注音失败：${error.message || String(error)}`);
  }

  function registerMenus({ onClearCache, onRetryFailures, onVisibilityChange }) {
    if (typeof registerMenu !== "function") return;
    registerMenu("设置 Yahoo Client ID", () =>
      configureAppId().catch(reportError),
    );
    registerMenu("切换按钮强制显示", () =>
      toggleForcedVisibility(onVisibilityChange).catch(reportError),
    );
    registerMenu("撤销当前站点正文发送许可", () =>
      revokeCurrentRemoteAccess().catch(reportError),
    );
    registerMenu("设置默认标注范围", () =>
      configureDefaultScope().catch(reportError),
    );
    registerMenu("重试失败片段", () =>
      Promise.resolve(onRetryFailures()).catch(reportError),
    );
    registerMenu("切换当前站点自动标注", () =>
      toggleAutoAnnotation().catch(reportError),
    );
    registerMenu("清理当前站点读音缓存", () =>
      clearCurrentCache(onClearCache).catch(reportError),
    );
    registerMenu("查看本次实际发送范围", showRemoteLog);
  }

  async function getDefaultScope() {
    const scope = await read(STORAGE_KEYS.defaultScope, "main");
    return Object.hasOwn(SCOPE_LABELS, scope) ? scope : "main";
  }

  async function configureDefaultScope() {
    const current = await getDefaultScope();
    const answer = window.prompt(
      "请选择默认标注范围：1=选中文本，2=正文区域，3=整页",
      String(["selection", "main", "page"].indexOf(current) + 1),
    );
    if (answer === null) return current;
    const scope = { 1: "selection", 2: "main", 3: "page" }[answer.trim()];
    if (!scope) throw new Error("标注范围只接受 1、2 或 3");
    await write(STORAGE_KEYS.defaultScope, scope);
    window.alert(`默认标注范围已设为：${SCOPE_LABELS[scope]}`);
    return scope;
  }

  async function toggleForcedVisibility(onVisibilityChange) {
    const current = await read(STORAGE_KEYS.forceButton, false);
    await write(STORAGE_KEYS.forceButton, !current);
    await onVisibilityChange();
  }

  async function isAutoAnnotateEnabled() {
    const origins = await readOriginList(STORAGE_KEYS.autoAnnotateOrigins);
    return origins.includes(currentOrigin(window));
  }

  async function toggleAutoAnnotation() {
    const origin = currentOrigin(window);
    const origins = await readOriginList(STORAGE_KEYS.autoAnnotateOrigins);
    const enabled = !origins.includes(origin);
    await write(
      STORAGE_KEYS.autoAnnotateOrigins,
      enabled ? [...origins, origin] : origins.filter((item) => item !== origin),
    );
    window.alert(`${origin} 自动标注已${enabled ? "开启" : "关闭"}`);
  }

  async function clearCurrentCache(onClearCache) {
    const count = await Promise.resolve(onClearCache());
    window.alert(`已清理当前站点 ${count} 个读音缓存条目`);
  }

  function resetRemoteLog(scope = "main") {
    remoteLog.scope = Object.hasOwn(SCOPE_LABELS, scope) ? scope : "main";
    remoteLog.requests.length = 0;
  }

  function recordRemoteRequest(text) {
    remoteLog.requests.push(String(text));
  }

  function showRemoteLog() {
    if (remoteLog.requests.length === 0) {
      window.alert("本次会话尚未向 Yahoo 发送文本");
      return;
    }
    const characters = remoteLog.requests.reduce((sum, text) => sum + text.length, 0);
    const previews = remoteLog.requests
      .slice(0, 5)
      .map((text, index) => `${index + 1}. ${compactPreview(text)}`)
      .join("\n");
    window.alert(
      `范围：${SCOPE_LABELS[remoteLog.scope]}\n实际请求：${remoteLog.requests.length} 次 / ${characters} 字\n${previews}`,
    );
  }

  async function revokeCurrentRemoteAccess() {
    const origin = currentOrigin(window);
    const origins = await readOrigins();
    await write(
      STORAGE_KEYS.remoteAccessOrigins,
      origins.filter((item) => item !== origin),
    );
    window.alert(`已撤销 ${origin} 的正文发送许可`);
  }

  return Object.freeze({
    pageStorage: readPageStorage(window),
    getDefaultScope,
    getRemoteAccess,
    isAutoAnnotateEnabled,
    isButtonForced: () => read(STORAGE_KEYS.forceButton, false),
    loadButtonPosition: (fallback) => read(STORAGE_KEYS.buttonPosition, fallback),
    recordRemoteRequest,
    registerMenus,
    resetRemoteLog,
    reportError,
    saveButtonPosition: (position) => write(STORAGE_KEYS.buttonPosition, position),
  });
}

async function readOriginListFrom(read, key) {
  const origins = await read(key, []);
  return Array.isArray(origins)
    ? origins.filter((item) => typeof item === "string")
    : [];
}

function compactPreview(text) {
  return String(text).replace(/\s+/g, " ").trim().slice(0, 80);
}

function currentOrigin(window) {
  const origin = window.location && window.location.origin;
  return typeof origin === "string" && origin ? origin : "当前页面";
}

function readPageStorage(window) {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

module.exports = Object.freeze({ createScriptCatAdapter });
