/**
 * [INPUT]: 依赖 src/page/dom.js Interface 与 jsdom 提供的浏览器 DOM
 * [OUTPUT]: 验证三种采集范围、内容排除、跨内联节点 ruby、元素身份与完整撤销
 * [POS]: work 的页面标注浏览器 DOM 回归测试，直接证明安全采集与可逆写回行为
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { createDomAdapter } = require("../src/page/dom");

test("选中文本、正文区域与整页范围只采集合格可见正文", () => {
  const { document, window, page } = createPage(`
    <nav>東京导航</nav>
    <main>
      <p id="target">記事の東<strong>京</strong>です</p>
      <p style="display:none">隠し漢字</p>
      <form><label>入力漢字<input value="秘密"></label></form>
      <pre>const 東京 = true</pre>
      <p><ruby>京都<rt>きょうと</rt></ruby></p>
    </main>
    <aside>大阪侧栏</aside>
    <section><p>本文外の名古屋</p></section>
  `);

  assert.deepEqual(texts(page.collect({ scope: "main" })), ["記事の東京です"]);
  assert.deepEqual(texts(page.collect({ scope: "page" })), [
    "記事の東京です",
    "本文外の名古屋",
  ]);

  const start = document.querySelector("#target").firstChild;
  const end = document.querySelector("#target strong").firstChild;
  const range = document.createRange();
  range.setStart(start, 3);
  range.setEnd(end, 1);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  assert.deepEqual(texts(page.collect({ scope: "selection" })), ["東京"]);
});

test("缺少语义正文容器时正文范围回退到 body", () => {
  const { page } = createPage(`
    <nav>東京导航</nav>
    <section><p>本文の京都</p></section>
    <aside>大阪侧栏</aside>
  `);

  assert.deepEqual(texts(page.collect({ scope: "main" })), ["本文の京都"]);
});

test("跨内联节点词语形成连续 ruby 并在撤销后保留原元素身份与事件", () => {
  const { document, window, page } = createPage(
    '<main><p id="target">私の東<strong data-kind="city">京</strong>です</p></main>',
  );
  const target = document.querySelector("#target");
  const strong = target.querySelector("strong");
  const originalMarkup = target.innerHTML;
  let clicks = 0;
  strong.addEventListener("click", () => {
    clicks += 1;
  });

  const groups = page.collect({ scope: "main" });
  const applied = page.apply(groups, [[{
    start: 2,
    end: 4,
    base: "東京",
    reading: "とうきょう",
  }]]);

  const ruby = target.querySelector("ruby[data-test-furigana]");
  assert.deepEqual(applied, { annotations: 1, characters: 2 });
  assert.equal(ruby.querySelector("rb").textContent, "東京");
  assert.equal(ruby.querySelector("rt").textContent, "とうきょう");
  assert.equal(target.querySelector("strong"), strong);
  strong.dispatchEvent(new window.Event("click"));
  assert.equal(clicks, 1);

  assert.equal(page.remove(), 1);
  assert.equal(target.innerHTML, originalMarkup);
  assert.equal(target.querySelector("strong"), strong);
  strong.dispatchEvent(new window.Event("click"));
  assert.equal(clicks, 2);
});

function texts(groups) {
  return groups.map((group) => group.text);
}

function createPage(html) {
  const dom = new JSDOM(`<!doctype html><html lang="ja"><body>${html}</body></html>`, {
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return this.hidden || this.style.display === "none" ? [] : [{ width: 1, height: 1 }];
    },
  });
  return {
    document,
    window: dom.window,
    page: createDomAdapter({
      document,
      window: dom.window,
      blockSelector: "p,li,blockquote,h1,h2,h3,h4,h5,h6",
      mainSelector: "main,article,[role='main']",
      skipSelector:
        "script,style,noscript,nav,header,footer,aside,form,textarea,input,button,select,option,code,pre,ruby,rt,rp,[contenteditable='true'],[aria-hidden='true'],[hidden]",
      rubyAttribute: "data-test-furigana",
    }),
  };
}
