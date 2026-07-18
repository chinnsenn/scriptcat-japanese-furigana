/**
 * [INPUT]: 依赖浏览器或 Node 提供的 TextEncoder 与标准 Unicode 正则能力
 * [OUTPUT]: 对外提供语言识别、UTF-8 分块、Yahoo 请求描述、读音区间生成、降级请求和节点映射算法
 * [POS]: src 的纯领域核心，被缓存、Yahoo、DOM、控制器和 Node 回归测试共同消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const API_URL = "https://jlp.yahooapis.jp/jsonrpc";
const API_METHOD = "jlp.furiganaservice.furigana";
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
  if (end === start) return start + String.fromCodePoint(text.codePointAt(start)).length;
  if (end < text.length && lastSentenceBreak > start) return lastSentenceBreak;
  return end;
}

function locateSurface(text, surface, cursor) {
  if (!surface) return -1;
  if (text.startsWith(surface, cursor)) return cursor;
  return text.indexOf(surface, cursor);
}

function appendWordAnnotations(output, word, wordStart) {
  const surface = word && typeof word.surface === "string" ? word.surface : "";
  const subwords = Array.isArray(word && word.subword) ? word.subword : [];
  if (subwords.length > 0) {
    appendSubwordAnnotations(output, surface, subwords, wordStart);
    return;
  }
  if (!hasKanji(surface) || typeof word.furigana !== "string" || !word.furigana) return;
  output.push({
    start: wordStart,
    end: wordStart + surface.length,
    base: surface,
    reading: word.furigana,
  });
}

function appendSubwordAnnotations(output, surface, subwords, wordStart) {
  let cursor = 0;
  for (const subword of subwords) {
    const subSurface = typeof subword.surface === "string" ? subword.surface : "";
    const subStart = locateSurface(surface, subSurface, cursor);
    if (subStart < 0) continue;
    appendWordAnnotations(output, subword, wordStart + subStart);
    cursor = subStart + subSurface.length;
  }
}

function annotationsFromYahooWords(text, words) {
  const annotations = [];
  let cursor = 0;
  for (const word of Array.isArray(words) ? words : []) {
    const surface = word && typeof word.surface === "string" ? word.surface : "";
    const wordStart = locateSurface(text, surface, cursor);
    if (wordStart < 0) continue;
    appendWordAnnotations(annotations, word, wordStart);
    cursor = wordStart + surface.length;
  }
  return annotations.filter(({ start, end }) => start >= 0 && end <= text.length);
}

function buildYahooRequest(appId, text) {
  const payload = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    jsonrpc: "2.0",
    method: API_METHOD,
    params: { q: text, grade: 1 },
  };
  return {
    method: "POST",
    url: `${API_URL}?appid=${encodeURIComponent(appId)}`,
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify(payload),
  };
}

function isInvalidParamsError(error) {
  return Boolean(
    error &&
      (error.code === -32602 || /Invalid params/i.test(String(error.message || ""))),
  );
}

async function requestWithInvalidParamsFallback(
  text,
  request,
  options = {},
  depth = 0,
) {
  const minimumBytes = options.minimumBytes ?? 96;
  const maxDepth = options.maxDepth ?? 8;
  try {
    const words = await request(text);
    return [{ text, start: 0, words, skipped: false }];
  } catch (error) {
    if (!isInvalidParamsError(error)) throw error;
    if (utf8Length(text) <= minimumBytes || depth >= maxDepth) {
      return [{ text, start: 0, words: [], skipped: true, error }];
    }
    return retrySmallerPieces(text, request, options, depth, minimumBytes, error);
  }
}

async function retrySmallerPieces(text, request, options, depth, minimumBytes, error) {
  const halfBytes = Math.max(minimumBytes, Math.ceil(utf8Length(text) / 2));
  const pieces = splitByUtf8Bytes(text, halfBytes);
  if (pieces.length < 2) return [{ text, start: 0, words: [], skipped: true, error }];

  const responses = [];
  for (const piece of pieces) {
    const nested = await requestWithInvalidParamsFallback(
      piece.text,
      request,
      options,
      depth + 1,
    );
    responses.push(
      ...nested.map((response) => ({
        ...response,
        start: response.start + piece.start,
      })),
    );
  }
  return responses;
}

function mapAnnotationsToNodes(nodes, annotations) {
  const ranges = createNodeRanges(nodes);
  const operations = [];
  for (const annotation of annotations) {
    const range = ranges.find(
      (candidate) =>
        annotation.start >= candidate.start && annotation.end <= candidate.end,
    );
    if (!range) continue;
    operations.push({
      node: range.node,
      start: annotation.start - range.start,
      end: annotation.end - range.start,
      base: annotation.base,
      reading: annotation.reading,
    });
  }
  return operations;
}

function createNodeRanges(nodes) {
  const ranges = [];
  let cursor = 0;
  for (const node of nodes) {
    const start = cursor;
    const end = start + node.data.length;
    ranges.push({ node, start, end });
    cursor = end;
  }
  return ranges;
}

module.exports = Object.freeze({
  API_CHUNK_BYTES,
  annotationsFromYahooWords,
  buildYahooRequest,
  hasKanji,
  isJapaneseText,
  mapAnnotationsToNodes,
  requestWithInvalidParamsFallback,
  splitByUtf8Bytes,
  utf8Length,
});
