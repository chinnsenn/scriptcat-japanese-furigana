/**
 * [INPUT]: 依赖 ../text.js 的汉字与日语识别算法、浏览器 DOM、采集范围与选择器配置
 * [OUTPUT]: 对外提供三范围 collect、跨节点 apply、保留节点身份的 remove 与 isJapanesePage
 * [POS]: page 的页面标注 Adapter，隐藏可见性、范围解析、区间映射、连续 ruby 与可逆 DOM 变更
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const { hasKanji, isJapaneseText } = require("../text");

const COLLECTION_SCOPES = Object.freeze({
  selection: "selection",
  main: "main",
  page: "page",
});

function createDomAdapter({
  document,
  window,
  blockSelector,
  mainSelector,
  skipSelector,
  rubyAttribute,
}) {
  function isElementVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.contentVisibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  }

  function isEligibleTextNode(node) {
    const parent = node.parentElement;
    if (!parent || !node.data.trim()) return false;
    if (parent.closest(skipSelector)) return false;
    if (parent.closest("ruby")) return false;
    return isElementVisible(parent);
  }

  function collect(options = {}) {
    const normalized = normalizeCollectOptions(options);
    const scope = normalized.scope || COLLECTION_SCOPES.page;
    const selectionRanges = scope === COLLECTION_SCOPES.selection
      ? readSelectionRanges(window)
      : [];
    if (scope === COLLECTION_SCOPES.selection && selectionRanges.length === 0) {
      return [];
    }
    const root = resolveCollectionRoot(
      document,
      scope,
      normalized.root,
      mainSelector,
    );
    if (!root) return [];

    const walker = document.createTreeWalker(
      root,
      document.defaultView.NodeFilter.SHOW_TEXT,
    );
    const groups = new Map();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!isEligibleTextNode(node)) continue;
      const bounds = selectedBounds(node, selectionRanges);
      if (!bounds || bounds.start === bounds.end) continue;
      const owner = node.parentElement.closest(blockSelector) || node.parentElement;
      const segments = groups.get(owner) || [];
      segments.push({ node, start: bounds.start, end: bounds.end });
      groups.set(owner, segments);
    }
    return Array.from(groups.values())
      .map((segments) => ({
        segments,
        text: segments
          .map(({ node, start, end }) => node.data.slice(start, end))
          .join(""),
      }))
      .filter((group) => hasKanji(group.text));
  }

  function createRuby(nodes, reading) {
    const ruby = document.createElement("ruby");
    const rb = document.createElement("rb");
    const rt = document.createElement("rt");
    ruby.setAttribute(rubyAttribute, "");
    ruby.title = reading;
    rb.append(...nodes);
    rt.textContent = reading;
    ruby.append(rb, rt);
    return ruby;
  }

  function apply(groups, analyses) {
    let annotations = 0;
    let characters = 0;
    for (let index = 0; index < groups.length; index += 1) {
      const entries = [...(analyses[index] || [])].sort(
        (left, right) => right.start - left.start,
      );
      for (const entry of entries) {
        const selectedNodes = isolateAnnotation(groups[index], entry);
        if (!selectedNodes || !wrapSelectedNodes(selectedNodes, entry.reading)) {
          continue;
        }
        annotations += 1;
        characters += Array.from(entry.base).filter(hasKanji).length;
      }
    }
    return { annotations, characters };
  }

  function wrapSelectedNodes(selectedNodes, reading) {
    const common = lowestCommonAncestor(selectedNodes);
    if (!common) return false;
    const first = childUnder(common, selectedNodes[0]);
    const last = childUnder(common, selectedNodes.at(-1));
    if (!first || !last || first.parentNode !== last.parentNode) return false;
    const siblings = siblingsBetween(first, last);
    const expected = selectedNodes.map((node) => node.data).join("");
    const actual = siblings.map((node) => node.textContent || "").join("");
    if (actual !== expected) return false;
    const ruby = createRuby([], reading);
    first.before(ruby);
    ruby.querySelector("rb").append(...siblings);
    return true;
  }

  function remove() {
    const parents = new Set();
    const rubies = document.querySelectorAll(`ruby[${rubyAttribute}]`);
    for (const ruby of rubies) {
      const rb = Array.from(ruby.children).find((child) => child.tagName === "RB");
      const parent = ruby.parentNode;
      const restored = document.createDocumentFragment();
      while (rb && rb.firstChild) restored.append(rb.firstChild);
      ruby.replaceWith(restored);
      if (parent) parents.add(parent);
    }
    for (const parent of parents) parent.normalize();
    return rubies.length;
  }

  function sampleVisibleText(limit = 6_000) {
    if (!document.body) return "";
    const groups = collect({ scope: COLLECTION_SCOPES.page });
    return groups.map((group) => group.text).join("").slice(0, limit);
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

function normalizeCollectOptions(options) {
  if (!options) return {};
  if (typeof options === "string") return { scope: options };
  if (options.nodeType) return { root: options };
  return options;
}

function resolveCollectionRoot(document, scope, explicitRoot, mainSelector) {
  if (scope === COLLECTION_SCOPES.main) {
    const main = document.querySelector(mainSelector) || document.body;
    if (!main) return null;
    if (!explicitRoot) return main;
    return main === explicitRoot || main.contains(explicitRoot) ? explicitRoot : null;
  }
  return explicitRoot || document.body;
}

function readSelectionRanges(window) {
  const selection = window.getSelection && window.getSelection();
  if (!selection || selection.isCollapsed) return [];
  return Array.from({ length: selection.rangeCount }, (_, index) =>
    selection.getRangeAt(index),
  ).filter((range) => !range.collapsed);
}

function selectedBounds(node, ranges) {
  if (ranges.length === 0) return { start: 0, end: node.data.length };
  for (const range of ranges) {
    if (!rangeIntersectsNode(range, node)) continue;
    const start = range.startContainer === node ? range.startOffset : 0;
    const end = range.endContainer === node ? range.endOffset : node.data.length;
    return {
      start: Math.max(0, Math.min(start, node.data.length)),
      end: Math.max(0, Math.min(end, node.data.length)),
    };
  }
  return null;
}

function rangeIntersectsNode(range, node) {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

function isolateAnnotation(group, annotation) {
  if (
    !annotation ||
    annotation.start < 0 ||
    annotation.start >= annotation.end ||
    annotation.end > group.text.length ||
    group.text.slice(annotation.start, annotation.end) !== annotation.base
  ) {
    return null;
  }
  const parts = annotationParts(group.segments, annotation);
  if (parts.length === 0) return null;
  const currentText = parts
    .map(({ node, start, end }) => node.data.slice(start, end))
    .join("");
  if (currentText !== annotation.base) return null;
  return parts.map(({ node, start, end }) => isolateText(node, start, end));
}

function annotationParts(segments, annotation) {
  const parts = [];
  let cursor = 0;
  for (const segment of segments) {
    const length = segment.end - segment.start;
    const overlapStart = Math.max(annotation.start, cursor);
    const overlapEnd = Math.min(annotation.end, cursor + length);
    if (overlapStart < overlapEnd) {
      parts.push({
        node: segment.node,
        start: segment.start + overlapStart - cursor,
        end: segment.start + overlapEnd - cursor,
      });
    }
    cursor += length;
  }
  return parts;
}

function isolateText(node, start, end) {
  if (end < node.data.length) node.splitText(end);
  return start > 0 ? node.splitText(start) : node;
}

function lowestCommonAncestor(nodes) {
  if (nodes.length === 0) return null;
  const ancestors = [];
  for (let current = nodes[0].parentNode; current; current = current.parentNode) {
    ancestors.push(current);
  }
  return ancestors.find((candidate) =>
    nodes.every((node) => candidate === node.parentNode || candidate.contains(node)),
  );
}

function childUnder(ancestor, node) {
  let current = node;
  while (current && current.parentNode !== ancestor) current = current.parentNode;
  return current;
}

function siblingsBetween(first, last) {
  const nodes = [];
  for (let current = first; current; current = current.nextSibling) {
    nodes.push(current);
    if (current === last) return nodes;
  }
  return [];
}

module.exports = Object.freeze({ COLLECTION_SCOPES, createDomAdapter });
