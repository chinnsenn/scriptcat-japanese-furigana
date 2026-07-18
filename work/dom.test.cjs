/**
 * [INPUT]: 依赖 src/page/dom.js Interface 与 jsdom 提供的浏览器 DOM
 * [OUTPUT]: 验证三态语言区间、证据偏移、三种范围、跨节点 ruby、元素身份与完整撤销
 * [POS]: work 的页面标注浏览器 DOM 回归测试，直接证明安全采集与可逆写回行为
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { createDomAdapter } = require("../src/page/dom");
const { LANGUAGE_KIND } = require("../src/text");

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

test("语言区间保留证据、DOM 来源与块内偏移", () => {
  const { document, page } = createPage(
    '<main><p id="mixed"><span lang="zh">中文段落。</span><span lang="ja">日本語の記事です。</span></p></main>',
    { pageLanguage: "zh-CN" },
  );

  const groups = page.collect({ scope: "main" });

  assert.deepEqual(
    groups.map(({ text, classification }) => [text, classification.kind]),
    [
      ["中文段落。", LANGUAGE_KIND.OTHER],
      ["日本語の記事です。", LANGUAGE_KIND.JAPANESE],
    ],
  );
  assert.equal(groups[0].source, document.querySelector("#mixed"));
  assert.equal(groups[0].sourceStart, 0);
  assert.equal(groups[0].sourceEnd, 5);
  assert.equal(groups[1].sourceStart, 5);
  assert.equal(groups[1].sourceEnd, 14);
  assert.deepEqual(groups[1].segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    sourceStart: segment.sourceStart,
    sourceEnd: segment.sourceEnd,
  })), [{ start: 0, end: 9, sourceStart: 5, sourceEnd: 14 }]);
  assert.deepEqual(groups[1].classification, {
    kind: LANGUAGE_KIND.JAPANESE,
    reason: "element-lang-ja",
    tag: "ja",
  });
});

test("短日语、纯汉字与显式语言按证据分类", () => {
  const { page } = createPage(`
    <main>
      <p id="short">東京へ行く</p>
      <p id="ambiguous">東京大学</p>
      <p id="chinese" lang="zh">中文内容</p>
    </main>
  `, { pageLanguage: "" });

  assert.deepEqual(
    page.collect({ scope: "main" }).map(({ text, classification }) => [
      text,
      classification.kind,
    ]),
    [
      ["東京へ行く", LANGUAGE_KIND.JAPANESE],
      ["東京大学", LANGUAGE_KIND.AMBIGUOUS],
      ["中文内容", LANGUAGE_KIND.OTHER],
    ],
  );
});

test("日语页面的纯汉字标题依据页面语言完成注音", () => {
  const { document, page } = createPage('<main><h1 id="title">東京大学</h1></main>');
  const [group] = page.collect({ scope: "main" });

  assert.deepEqual(group.classification, {
    kind: LANGUAGE_KIND.JAPANESE,
    reason: "page-lang-ja",
    tag: "ja",
  });
  assert.deepEqual(page.apply([group], [[{
    start: 0,
    end: 4,
    base: "東京大学",
    reading: "とうきょうだいがく",
  }]]), { annotations: 1, characters: 4 });
  assert.equal(document.querySelector("#title ruby rt").textContent, "とうきょうだいがく");
});

test("选中文本作为显式意图强制分析歧义纯汉字", () => {
  const { document, window, page } = createPage(
    '<main><p id="target">前文東京大学后文</p></main>',
    { pageLanguage: "" },
  );
  const text = document.querySelector("#target").firstChild;
  const range = document.createRange();
  range.setStart(text, 2);
  range.setEnd(text, 6);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const [group] = page.collect({ scope: "selection" });

  assert.equal(group.text, "東京大学");
  assert.deepEqual(group.classification, {
    kind: LANGUAGE_KIND.JAPANESE,
    reason: "selection",
    tag: "ja",
  });
  assert.equal(group.segments[0].start, 2);
  assert.equal(group.segments[0].end, 6);

  const applied = page.apply([group], [[{
    start: 0,
    end: 4,
    base: "東京大学",
    reading: "とうきょうだいがく",
  }]]);
  assert.deepEqual(applied, { annotations: 1, characters: 4 });
  assert.equal(document.querySelector("#target ruby").textContent, "東京大学とうきょうだいがく");
});

function texts(groups) {
  return groups.map((group) => group.text);
}

function createPage(html, { pageLanguage = "ja" } = {}) {
  const lang = pageLanguage ? ` lang="${pageLanguage}"` : "";
  const dom = new JSDOM(`<!doctype html><html${lang}><body>${html}</body></html>`, {
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
