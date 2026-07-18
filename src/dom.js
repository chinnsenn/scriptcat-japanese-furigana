/**
 * [INPUT]: 依赖 core.js 的汉字与日语识别算法、浏览器 document/window 和选择器配置
 * [OUTPUT]: 对外提供 collect、apply、remove、isJapanesePage 四个页面标注接口
 * [POS]: src 的 DOM 深模块，隐藏可见性判断、TreeWalker 分组、ruby 变更与可逆恢复细节
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const { hasKanji, isJapaneseText } = require("./core");

function createDomAdapter({
  document,
  window,
  blockSelector,
  skipSelector,
  rubyAttribute,
}) {
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
    if (parent.closest(skipSelector)) return false;
    if (parent.closest(`[${rubyAttribute}]`)) return false;
    return isElementVisible(parent);
  }

  function collect(root = document.body) {
    if (!root) return [];
    const walker = document.createTreeWalker(
      root,
      document.defaultView.NodeFilter.SHOW_TEXT,
    );
    const groups = new Map();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!isEligibleTextNode(node)) continue;
      const owner = node.parentElement.closest(blockSelector) || node.parentElement;
      const nodes = groups.get(owner) || [];
      nodes.push(node);
      groups.set(owner, nodes);
    }
    return Array.from(groups.values())
      .map((nodes) => ({ nodes, text: nodes.map((node) => node.data).join("") }))
      .filter((group) => hasKanji(group.text));
  }

  function createRuby(base, reading) {
    const ruby = document.createElement("ruby");
    const rb = document.createElement("rb");
    const rt = document.createElement("rt");
    ruby.setAttribute(rubyAttribute, "");
    ruby.title = reading;
    rb.textContent = base;
    rt.textContent = reading;
    ruby.append(rb, rt);
    return ruby;
  }

  function apply(operations) {
    const byNode = groupOperationsByNode(operations);
    let annotations = 0;
    let characters = 0;
    for (const [node, entries] of byNode) {
      entries.sort((left, right) => right.start - left.start);
      for (const entry of entries) {
        if (!canApply(node, entry)) continue;
        node.splitText(entry.end);
        const target = node.splitText(entry.start);
        target.replaceWith(createRuby(entry.base, entry.reading));
        annotations += 1;
        characters += Array.from(entry.base).filter(hasKanji).length;
      }
    }
    return { annotations, characters };
  }

  function remove() {
    const parents = new Set();
    const rubies = document.querySelectorAll(`ruby[${rubyAttribute}]`);
    for (const ruby of rubies) {
      const rb = Array.from(ruby.children).find((child) => child.tagName === "RB");
      const parent = ruby.parentNode;
      ruby.replaceWith(document.createTextNode(rb ? rb.textContent : ""));
      if (parent) parents.add(parent);
    }
    for (const parent of parents) parent.normalize();
    return rubies.length;
  }

  function sampleVisibleText(limit = 6_000) {
    if (!document.body) return "";
    const walker = document.createTreeWalker(
      document.body,
      document.defaultView.NodeFilter.SHOW_TEXT,
    );
    let output = "";
    for (let node = walker.nextNode(); node && output.length < limit; node = walker.nextNode()) {
      if (isEligibleTextNode(node)) output += node.data;
    }
    return output.slice(0, limit);
  }

  function isJapanesePage() {
    const language = document.documentElement.lang.toLowerCase();
    return (
      language === "ja" ||
      language.startsWith("ja-") ||
      isJapaneseText(sampleVisibleText())
    );
  }

  return Object.freeze({ apply, collect, isJapanesePage, remove });
}

function groupOperationsByNode(operations) {
  const byNode = new Map();
  for (const operation of operations) {
    const entries = byNode.get(operation.node) || [];
    entries.push(operation);
    byNode.set(operation.node, entries);
  }
  return byNode;
}

function canApply(node, entry) {
  return (
    node.isConnected &&
    entry.start >= 0 &&
    entry.start < entry.end &&
    entry.end <= node.data.length &&
    node.data.slice(entry.start, entry.end) === entry.base
  );
}

module.exports = Object.freeze({ createDomAdapter });
