/**
 * [INPUT]: 依赖浏览器或 Node 提供的 TextEncoder 与标准 Unicode 正则能力
 * [OUTPUT]: 对外提供汉字判断、日语识别、UTF-8 长度和按句界安全分块算法
 * [POS]: src 的共享纯文本 Module，被 reading 与 page 两个领域模块共同消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const API_CHUNK_BYTES = 3_000;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const KANJI_RE = /\p{Script=Han}/u;
const LETTER_RE = /[\p{L}]/gu;
const SENTENCE_BREAK_RE = /[。！？!?\n]/u;

function hasKanji(text) {
  return KANJI_RE.test(text);
}

function isJapaneseText(text) {
  const kanaCount = (text.match(KANA_RE) || []).length;
  const letterCount = (text.match(LETTER_RE) || []).length;
  return kanaCount >= 20 && kanaCount / Math.max(letterCount, 1) >= 0.05;
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
  hasKanji,
  isJapaneseText,
  splitByUtf8Bytes,
  utf8Length,
});
