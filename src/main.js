/**
 * [INPUT]: 依赖 reading、page、media、scriptcat Module 工厂与浏览器/ScriptCat 全局能力
 * [OUTPUT]: 构造生产 Adapter、早期安装视频焦点守卫、连接三态语言过滤与读音 Module Interface 并启动唯一注音会话
 * [POS]: src 的浅组合根，有意只保留早期守卫、依赖装配与启动顺序
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const { createReadingEngine } = require("./reading/engine");
const { createYahooAdapter } = require("./reading/yahoo");
const { createFuriganaApp, createBrowserRuntime } = require("./page/app");
const { createDomAdapter } = require("./page/dom");
const { createFloatingUi } = require("./page/ui");
const { createVideoFocusGuard } = require("./media/guard");
const { createScriptCatAdapter } = require("./scriptcat");

const UI_HOST_ID = "scriptcat-japanese-furigana-ui";
const RUBY_ATTRIBUTE = "data-scriptcat-furigana";
const BLOCK_SELECTOR =
  "p,li,dd,dt,blockquote,figcaption,h1,h2,h3,h4,h5,h6,td,th";
const MAIN_SELECTOR = "main,article,[role='main']";
const SKIP_SELECTOR =
  "script,style,noscript,nav,header,footer,aside,form,textarea,input,button,select,option,code,pre,ruby,rt,rp,svg,canvas,[role='navigation'],[role='banner'],[role='complementary'],[contenteditable='true'],[aria-hidden='true'],[hidden]";

if (typeof document !== "undefined" && typeof window !== "undefined") start();

function start() {
  const platform = createScriptCatAdapter({
    window,
    getValue: typeof GM_getValue === "function" ? GM_getValue : undefined,
    setValue: typeof GM_setValue === "function" ? GM_setValue : undefined,
    registerMenu:
      typeof GM_registerMenuCommand === "function"
        ? GM_registerMenuCommand
        : undefined,
  });
  const videoFocusGuard = createVideoFocusGuard({
    document,
    window,
    isEnabled: platform.isVideoFocusGuardEnabled,
    onWarning: (error) =>
      console.warn("[日语网页汉字注音] 视频防暂停处理失败", error),
  });
  videoFocusGuard.start().catch(platform.reportError);
  platform.registerVideoFocusGuardMenu({
    onChange: (enabled) => videoFocusGuard.setEnabled(enabled),
  });
  whenDocumentReady(document, window, () => startFurigana(platform)).catch(
    platform.reportError,
  );
}

function startFurigana(platform) {
  const yahoo = createYahooAdapter({
    request:
      typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : undefined,
    onRequest: ({ text }) => platform.recordRemoteRequest(text),
  });
  const reader = createReadingEngine({
    requestWords: yahoo.request,
    getRemoteAccess: platform.getRemoteAccess,
    storage: platform.pageStorage,
    onSkipped: (fragment) =>
      console.warn(
        "[日语网页汉字注音] 跳过 Yahoo 无法解析的文本片段",
        fragment,
      ),
  });
  const page = createDomAdapter({
    document,
    window,
    blockSelector: BLOCK_SELECTOR,
    mainSelector: MAIN_SELECTOR,
    skipSelector: SKIP_SELECTOR,
    rubyAttribute: RUBY_ATTRIBUTE,
  });
  const runtime = createBrowserRuntime({ window, document });
  let app;
  const control = createFloatingUi({
    document,
    window,
    hostId: UI_HOST_ID,
    loadPosition: platform.loadButtonPosition,
    savePosition: platform.saveButtonPosition,
    onToggle: () => app.toggle(),
    onWarning: (error) =>
      console.warn("[日语网页汉字注音] 按钮位置处理失败", error),
  });
  app = createFuriganaApp({ page, reader, control, platform, runtime });
  return app.start();
}

function whenDocumentReady(document, window, callback) {
  if (document.body) return Promise.resolve().then(callback);
  return new Promise((resolve, reject) => {
    let observer = null;
    const cleanup = () => {
      document.removeEventListener("DOMContentLoaded", done, true);
      window.removeEventListener("load", done, true);
      observer?.disconnect();
    };
    const done = () => {
      if (!document.body) return;
      cleanup();
      Promise.resolve()
        .then(callback)
        .then(resolve, reject);
    };
    document.addEventListener("DOMContentLoaded", done, true);
    window.addEventListener("load", done, true);
    if (typeof window.MutationObserver === "function" && document.documentElement) {
      observer = new window.MutationObserver(done);
      observer.observe(document.documentElement, { childList: true });
    }
    done();
  });
}
