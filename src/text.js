/**
 * [INPUT]: 依赖浏览器或 Node 提供的 TextEncoder 与标准 Unicode 正则能力
 * [OUTPUT]: 对外提供统一三态日语证据分类、汉字判断、UTF-8 长度和按句界安全分块算法
 * [POS]: src 的共享纯文本 Module，被 reading 与 page 两个领域模块共同消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const API_CHUNK_BYTES = 3_000;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const KANJI_RE = /\p{Script=Han}/u;
const SENTENCE_BREAK_RE = /[。！？!?\n]/u;
const LANGUAGE_KIND = Object.freeze({
  JAPANESE: "japanese",
  OTHER: "other",
  AMBIGUOUS: "ambiguous",
});

function hasKanji(text) {
  return KANJI_RE.test(text);
}

function classifyJapaneseText({
  text,
  elementLanguage = null,
  pageLanguage = "",
  forced = false,
}) {
  if (forced) return classification(LANGUAGE_KIND.JAPANESE, "selection", "ja");

  const elementTag = normalizeLanguageTag(elementLanguage);
  if (elementTag === "ja") {
    return classification(LANGUAGE_KIND.JAPANESE, "element-lang-ja", elementTag);
  }
  if (elementTag) {
    return classification(LANGUAGE_KIND.OTHER, `element-lang-${elementTag}`, elementTag);
  }
  if ((text.match(KANA_RE) || []).length > 0) {
    return classification(LANGUAGE_KIND.JAPANESE, "kana", "ja");
  }
  if (elementLanguage !== null) {
    return classification(LANGUAGE_KIND.AMBIGUOUS, "han-only", "");
  }

  const pageTag = normalizeLanguageTag(pageLanguage);
  if (pageTag === "ja") {
    return classification(LANGUAGE_KIND.JAPANESE, "page-lang-ja", pageTag);
  }
  if (pageTag === "zh" || pageTag === "ko") {
    return classification(LANGUAGE_KIND.OTHER, `page-lang-${pageTag}`, pageTag);
  }
  return classification(LANGUAGE_KIND.AMBIGUOUS, "han-only", "");
}

function normalizeLanguageTag(language) {
  return typeof language === "string"
    ? language.trim().toLowerCase().split(/[-_]/u, 1)[0]
    : "";
}

function classification(kind, reason, tag) {
  return { kind, reason, tag };
}

function utf8Length(text) {
  return new TextEncoder().encode(text).length;
}

function splitByUtf8Bytes(text, maxBytes = API_CHUNK_BYTES) {
  if (!text) return [];
  if (maxBytes < 4) throw new RangeError("maxBytes 必须至少为 4");

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const boundary = findChunkBoundary(text, start, maxBytes);
    chunks.push({ text: text.slice(start, boundary), start, end: boundary });
    start = boundary;
  }
  return chunks;
}

function findChunkBoundary(text, start, maxBytes) {
  let end = start;
  let bytes = 0;
  let lastSentenceBreak = -1;
  while (end < text.length) {
    const character = String.fromCodePoint(text.codePointAt(end));
    const characterBytes = utf8Length(character);
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    end += character.length;
    if (SENTENCE_BREAK_RE.test(character)) lastSentenceBreak = end;
  }
  if (end === start) {
    return start + String.fromCodePoint(text.codePointAt(start)).length;
  }
  if (end < text.length && lastSentenceBreak > start) return lastSentenceBreak;
  return end;
}

module.exports = Object.freeze({
  API_CHUNK_BYTES,
  LANGUAGE_KIND,
  classifyJapaneseText,
  hasKanji,
  splitByUtf8Bytes,
  utf8Length,
});
