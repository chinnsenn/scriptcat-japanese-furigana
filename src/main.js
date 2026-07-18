/**
 * [INPUT]: 依赖 reading、page、scriptcat Module 工厂与浏览器/ScriptCat 全局能力
 * [OUTPUT]: 构造生产 Adapter、连接 Module Interface 并启动唯一注音会话
 * [POS]: src 的浅组合根，有意只保留依赖装配与启动顺序
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const { createReadingEngine } = require("./reading/engine");
const { createYahooAdapter } = require("./reading/yahoo");
const { createFuriganaApp, createBrowserRuntime } = require("./page/app");
const { createDomAdapter } = require("./page/dom");
const { createFloatingUi } = require("./page/ui");
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
  app.start().catch(platform.reportError);
}
