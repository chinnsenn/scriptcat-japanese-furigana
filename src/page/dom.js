/**
 * [INPUT]: 依赖 ../text.js 的三态语言分类、浏览器 DOM、采集范围与选择器配置
 * [OUTPUT]: 对外提供携带语言证据与来源偏移的 collect、跨节点 apply、可逆 remove 与 isJapanesePage
 * [POS]: page 的页面标注 Adapter，隐藏可见性、语言区间、范围解析、连续 ruby 与可逆 DOM 变更
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const {
  LANGUAGE_KIND,
  classifyJapaneseText,
  hasKanji,
} = require("../text");

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
    const sources = new Map();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!isEligibleTextNode(node)) continue;
      const bounds = selectedBounds(node, selectionRanges);
      if (!bounds || bounds.start === bounds.end) continue;
      const owner = node.parentElement.closest(blockSelector) || node.parentElement;
      const segments = sources.get(owner) || [];
      segments.push({
        node,
        start: bounds.start,
        end: bounds.end,
        elementLanguage: findElementLanguage(node.parentElement, document.documentElement),
      });
      sources.set(owner, segments);
    }
    const pageLanguage = document.documentElement.getAttribute("lang") || "";
    const forced = scope === COLLECTION_SCOPES.selection;
    return Array.from(sources.entries()).flatMap(([source, segments]) =>
      classifySourceSegments(source, segments, { pageLanguage, forced }),
    );
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

  function isJapanesePage() {
    const language = document.documentElement.lang.toLowerCase();
    return (
      language === "ja" ||
      language.startsWith("ja-") ||
      collect({ scope: COLLECTION_SCOPES.page }).some(
        (group) => group.classification.kind === LANGUAGE_KIND.JAPANESE,
      )
    );
  }

  return Object.freeze({ apply, collect, isJapanesePage, remove });
}

function classifySourceSegments(source, segments, context) {
  const candidates = createLanguageCandidates(source, addSourceOffsets(segments));
  for (const candidate of candidates) {
    candidate.classification = classifyJapaneseText({
      text: candidate.text,
      elementLanguage: candidate.elementLanguage,
      pageLanguage: context.pageLanguage,
      forced: context.forced,
    });
    candidate.evidence = [candidate.classification];
  }
  inferAdjacentJapanese(candidates);
  return mergeClassifiedCandidates(candidates).filter((group) => hasKanji(group.text));
}

function addSourceOffsets(segments) {
  let cursor = 0;
  return segments.map((segment) => {
    const length = segment.end - segment.start;
    const positioned = {
      ...segment,
      sourceStart: cursor,
      sourceEnd: cursor + length,
    };
    cursor += length;
    return positioned;
  });
}

function createLanguageCandidates(source, segments) {
  const candidates = [];
  let current = null;
  for (const segment of segments) {
    for (const piece of splitAtSentenceBreaks(segment)) {
      if (current && current.elementLanguage !== piece.elementLanguage) {
        candidates.push(current);
        current = null;
      }
      current ||= createCandidate(source, piece);
      appendCandidateSegment(current, piece);
      if (piece.boundaryAfter) {
        candidates.push(current);
        current = null;
      }
    }
  }
  if (current) candidates.push(current);
  return candidates.filter((candidate) => candidate.text.trim());
}

function splitAtSentenceBreaks(segment) {
  const pieces = [];
  const text = segment.node.data.slice(segment.start, segment.end);
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!/[。！？!?\n]/u.test(text[index])) continue;
    pieces.push(createSegmentPiece(segment, start, index + 1, true));
    start = index + 1;
  }
  if (start < text.length) {
    pieces.push(createSegmentPiece(segment, start, text.length, false));
  }
  return pieces;
}

function createSegmentPiece(segment, start, end, boundaryAfter) {
  return {
    ...segment,
    start: segment.start + start,
    end: segment.start + end,
    sourceStart: segment.sourceStart + start,
    sourceEnd: segment.sourceStart + end,
    boundaryAfter,
  };
}

function createCandidate(source, segment) {
  return {
    source,
    sourceStart: segment.sourceStart,
    sourceEnd: segment.sourceStart,
    segments: [],
    text: "",
    elementLanguage: segment.elementLanguage,
    boundaryAfter: false,
  };
}

function appendCandidateSegment(candidate, segment) {
  candidate.segments.push(withoutBoundary(segment));
  candidate.text += segment.node.data.slice(segment.start, segment.end);
  candidate.sourceEnd = segment.sourceEnd;
  candidate.boundaryAfter = segment.boundaryAfter;
}

function withoutBoundary(segment) {
  const { boundaryAfter: _boundaryAfter, elementLanguage: _language, ...plain } = segment;
  return plain;
}

function inferAdjacentJapanese(candidates) {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.classification.kind !== LANGUAGE_KIND.AMBIGUOUS) continue;
    const previousIsJapanese =
      candidates[index - 1]?.classification.kind === LANGUAGE_KIND.JAPANESE &&
      !candidates[index - 1].boundaryAfter;
    const nextIsJapanese =
      candidates[index + 1]?.classification.kind === LANGUAGE_KIND.JAPANESE &&
      !candidate.boundaryAfter;
    if (!previousIsJapanese && !nextIsJapanese) continue;
    candidate.classification = {
      kind: LANGUAGE_KIND.JAPANESE,
      reason: "adjacent-japanese",
      tag: "ja",
    };
    candidate.evidence = [candidate.classification];
  }
}

function mergeClassifiedCandidates(candidates) {
  const groups = [];
  for (const candidate of candidates) {
    const previous = groups.at(-1);
    if (!canMergeClassified(previous, candidate)) {
      groups.push(candidate);
      continue;
    }
    previous.text += candidate.text;
    previous.sourceEnd = candidate.sourceEnd;
    previous.segments = coalesceSegments([...previous.segments, ...candidate.segments]);
    previous.evidence.push(...candidate.evidence);
    previous.boundaryAfter = candidate.boundaryAfter;
  }
  return groups;
}

function canMergeClassified(left, right) {
  return Boolean(
    left &&
      left.source === right.source &&
      left.sourceEnd === right.sourceStart &&
      left.classification.kind === right.classification.kind,
  );
}

function coalesceSegments(segments) {
  const output = [];
  for (const segment of segments) {
    const previous = output.at(-1);
    if (
      previous &&
      previous.node === segment.node &&
      previous.end === segment.start &&
      previous.sourceEnd === segment.sourceStart
    ) {
      previous.end = segment.end;
      previous.sourceEnd = segment.sourceEnd;
      continue;
    }
    output.push({ ...segment });
  }
  return output;
}

function findElementLanguage(element, documentElement) {
  for (let current = element; current && current !== documentElement; current = current.parentElement) {
    if (current.hasAttribute("lang")) return current.getAttribute("lang");
  }
  return null;
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
