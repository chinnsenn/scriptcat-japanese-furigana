/**
 * [INPUT]: 依赖浏览器 window 与 GM_getValue、GM_setValue、GM_registerMenuCommand Adapter
 * [OUTPUT]: 对外提供宽型 Client ID 配置框、站点许可/白名单、范围、发送审计、缓存菜单、页面存储与错误反馈 Interface
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
    const next = await requestClientId(window, current);
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

function requestClientId(window, current) {
  const document = window.document;
  if (!document || typeof document.createElement !== "function") {
    return Promise.resolve(
      window.prompt("请输入 Yahoo! JAPAN Developer Network Client ID", current),
    );
  }
  const dialog = document.createElement("dialog");
  if (typeof dialog.showModal !== "function") {
    return Promise.resolve(
      window.prompt("请输入 Yahoo! JAPAN Developer Network Client ID", current),
    );
  }
  return openClientIdDialog(window, document, dialog, current);
}

function openClientIdDialog(window, document, dialog, current) {
  const host = document.createElement("div");
  const backdropStyle = document.createElement("style");
  const shadow = host.attachShadow({ mode: "open" });
  host.dataset.dialogRoot = "client-id";
  backdropStyle.textContent =
    "dialog[data-scriptcat-furigana-dialog='client-id']::backdrop{background:rgba(31,30,25,.32);backdrop-filter:blur(3px)}";
  shadow.innerHTML = CLIENT_ID_DIALOG_MARKUP;
  dialog.setAttribute("aria-label", "设置 Yahoo Client ID");
  dialog.dataset.scriptcatFuriganaDialog = "client-id";
  dialog.style.cssText =
    "max-width:none;max-height:none;padding:0;overflow:visible;border:0;background:transparent";
  dialog.append(backdropStyle, host);
  const form = shadow.querySelector("form");
  const input = shadow.querySelector("textarea");
  const count = shadow.querySelector("[data-count]");
  const clear = shadow.querySelector("[data-clear]");
  const cancel = shadow.querySelector("[data-cancel]");
  input.value = current;

  return new Promise((resolve) => {
    let settled = false;

    const updateCount = () => {
      count.textContent = `${input.value.length} 字符`;
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener("cancel", cancelDialog);
      dialog.removeEventListener("close", closeDialog);
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      dialog.remove();
      resolve(value);
    };
    const cancelDialog = (event) => {
      event.preventDefault();
      finish(null);
    };
    const closeDialog = () => finish(null);

    input.addEventListener("input", updateCount);
    clear.addEventListener("click", () => {
      input.value = "";
      updateCount();
      input.focus();
    });
    cancel.addEventListener("click", () => finish(null));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(input.value);
    });
    dialog.addEventListener("cancel", cancelDialog);
    dialog.addEventListener("close", closeDialog);
    updateCount();
    document.documentElement.append(dialog);
    dialog.showModal();
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => input.focus());
    } else {
      input.focus();
    }
  });
}

const CLIENT_ID_DIALOG_MARKUP = `
  <style>
    :host { display:block; color-scheme:light; }
    .panel { box-sizing:border-box; width:min(560px,calc(100vw - 32px)); padding:24px; border:1px solid #d9d4c6; border-radius:20px; color:#252620; background:#f6f2e8; box-shadow:0 24px 80px rgba(31,30,25,.3); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; animation:dialog-in .18s cubic-bezier(.22,1,.36,1); }
    .eyebrow { margin:0 0 6px; color:#67705e; font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
    h2 { margin:0; font-size:21px; line-height:1.25; letter-spacing:-.02em; }
    .help { margin:8px 0 18px; color:#66665e; }
    label { display:block; margin-bottom:7px; font-size:12px; font-weight:700; }
    textarea { box-sizing:border-box; display:block; width:100%; min-height:104px; padding:13px 14px; resize:vertical; border:1px solid #bdb8aa; border-radius:12px; outline:none; color:#22231e; background:#fffdf7; box-shadow:0 1px 0 rgba(255,255,255,.8) inset; font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; overflow-wrap:anywhere; word-break:break-all; transition:border-color .15s ease,box-shadow .15s ease; }
    textarea:focus { border-color:#667b5d; box-shadow:0 0 0 3px rgba(102,123,93,.18); }
    .meta { display:flex; justify-content:space-between; gap:16px; margin-top:7px; color:#77776d; font-size:11px; }
    .privacy { max-width:390px; }
    .actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; margin-top:22px; }
    button { min-height:38px; padding:0 14px; border:1px solid transparent; border-radius:999px; font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; cursor:pointer; }
    button:focus-visible { outline:3px solid rgba(102,123,93,.28); outline-offset:2px; }
    .ghost { color:#53544d; background:transparent; }
    .ghost:hover { background:#ebe6da; }
    .save { padding-inline:18px; color:#f7f2e7; background:#28483b; box-shadow:0 5px 14px rgba(40,72,59,.2); }
    .save:hover { background:#1f3b30; }
    @keyframes dialog-in { from { opacity:0; transform:translateY(8px) scale(.985); } }
    @media (max-width:480px) { .panel { padding:20px; } .meta { display:block; } .actions { flex-wrap:wrap; } }
    @media (prefers-reduced-motion:reduce) { .panel { animation:none; } }
  </style>
  <form class="panel">
    <p class="eyebrow">Yahoo! JAPAN</p>
    <h2>设置 Client ID</h2>
    <p class="help">粘贴 Yahoo! JAPAN Developer Network 提供的完整 Client ID。</p>
    <label for="client-id">Client ID</label>
    <textarea id="client-id" rows="4" wrap="soft" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="粘贴完整 Client ID"></textarea>
    <div class="meta">
      <span class="privacy">仅保存在 ScriptCat 脚本存储中</span>
      <span data-count>0 字符</span>
    </div>
    <div class="actions">
      <button class="ghost" type="button" data-clear>清空</button>
      <button class="ghost" type="button" data-cancel>取消</button>
      <button class="save" type="submit">保存</button>
    </div>
  </form>
`;

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
