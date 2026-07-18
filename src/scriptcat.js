/**
 * [INPUT]: 依赖浏览器 window 与 GM_getValue、GM_setValue、GM_registerMenuCommand Adapter
 * [OUTPUT]: 对外提供页面存储、远程授权、按钮位置、强制显隐、配置菜单和错误反馈 Interface
 * [POS]: src 的 ScriptCat Adapter，集中所有用户脚本平台差异与交互式配置
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const STORAGE_KEYS = Object.freeze({
  appId: "yahooClientId",
  privacyAccepted: "privacyAccepted",
  forceButton: "forceButton",
  buttonPosition: "buttonPosition",
});

function createScriptCatAdapter({ window, getValue, setValue, registerMenu }) {
  const read = (key, fallback) =>
    typeof getValue === "function"
      ? Promise.resolve(getValue(key, fallback))
      : Promise.resolve(fallback);
  const write = (key, value) =>
    typeof setValue === "function"
      ? Promise.resolve(setValue(key, value))
      : Promise.resolve();

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

  async function getRemoteAccess() {
    let appId = await read(STORAGE_KEYS.appId, "");
    if (!appId) appId = await configureAppId();
    if (!appId) return "";
    const accepted = await read(STORAGE_KEYS.privacyAccepted, false);
    if (accepted) return appId;
    const confirmed = window.confirm(
      "注音时会把当前页面的可见正文分段发送到 Yahoo! JAPAN ルビ振り API。是否继续？",
    );
    if (!confirmed) return "";
    await write(STORAGE_KEYS.privacyAccepted, true);
    return appId;
  }

  function reportError(error) {
    console.error("[日语网页汉字注音]", error);
    window.alert(`注音失败：${error.message || String(error)}`);
  }

  function registerMenus({ onVisibilityChange }) {
    if (typeof registerMenu !== "function") return;
    registerMenu("设置 Yahoo Client ID", () => {
      configureAppId().catch(reportError);
    });
    registerMenu("切换按钮强制显示", () => {
      toggleForcedVisibility(onVisibilityChange).catch(reportError);
    });
    registerMenu("重置正文发送确认", () => {
      resetPrivacyConfirmation().catch(reportError);
    });
  }

  async function toggleForcedVisibility(onVisibilityChange) {
    const current = await read(STORAGE_KEYS.forceButton, false);
    await write(STORAGE_KEYS.forceButton, !current);
    await onVisibilityChange();
  }

  async function resetPrivacyConfirmation() {
    await write(STORAGE_KEYS.privacyAccepted, false);
    window.alert("正文发送确认已重置");
  }

  return Object.freeze({
    pageStorage: readPageStorage(window),
    getRemoteAccess,
    isButtonForced: () => read(STORAGE_KEYS.forceButton, false),
    loadButtonPosition: (fallback) => read(STORAGE_KEYS.buttonPosition, fallback),
    registerMenus,
    reportError,
    saveButtonPosition: (position) => write(STORAGE_KEYS.buttonPosition, position),
  });
}

function readPageStorage(window) {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

module.exports = Object.freeze({ createScriptCatAdapter });
