/**
 * [INPUT]: 依赖 package.json 的版本、src/main.js 的浏览器入口与 esbuild 打包能力
 * [OUTPUT]: 生成带 ScriptCat 元数据、1.0 动态会话能力和 L3 契约的 outputs/japanese-furigana.user.js
 * [POS]: scripts 的唯一构建入口，把可维护源码收敛为可安装单文件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const path = require("node:path");
const { build } = require("esbuild");
const packageJson = require("../package.json");

const root = path.resolve(__dirname, "..");
const metadata = `// ==UserScript==
// @name         Japanese Furigana for Web Pages
// @name:ja      日本語ウェブページ漢字ルビ
// @namespace    https://github.com/chinnsenn/scriptcat-japanese-furigana
// @version      ${packageJson.version}
// @description  Add context-aware furigana to kanji on Japanese web pages
// @description:zh-CN 识别日语页面并使用上下文相关读音为汉字添加 ruby 注音
// @description:ja 文脈に応じた読み方で日本語ページの漢字にルビを付けます
// @author       chinnsenn
// @license      MIT
// @homepageURL  https://github.com/chinnsenn/scriptcat-japanese-furigana
// @supportURL   https://github.com/chinnsenn/scriptcat-japanese-furigana/issues
// @downloadURL  https://raw.githubusercontent.com/chinnsenn/scriptcat-japanese-furigana/main/outputs/japanese-furigana.user.js
// @updateURL    https://raw.githubusercontent.com/chinnsenn/scriptcat-japanese-furigana/main/outputs/japanese-furigana.user.js
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
 * [OUTPUT]: 对外提供范围采集、站点授权、进度取消、韧性请求、跨节点 ruby 与 SPA 增量处理
 * [POS]: outputs 的自动生成安装产物，源码入口位于 src/main.js
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */`;

build({
  entryPoints: [path.join(root, "src/main.js")],
  outfile: path.join(root, "outputs/japanese-furigana.user.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["chrome100", "firefox100", "safari15"],
  minify: true,
  legalComments: "none",
  banner: { js: metadata },
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
