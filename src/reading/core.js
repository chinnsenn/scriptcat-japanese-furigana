/**
 * [INPUT]: 依赖 ../text.js 的 UTF-8 分块与汉字判断算法
 * [OUTPUT]: 对外提供 Yahoo 请求描述、词结果对齐和 Invalid params 自适应降级算法
 * [POS]: reading 的纯领域算法，被 engine.js、yahoo.js 与 Node 回归测试消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const { hasKanji, splitByUtf8Bytes, utf8Length } = require("../text");

const API_URL = "https://jlp.yahooapis.jp/jsonrpc";
const API_METHOD = "jlp.furiganaservice.furigana";

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

module.exports = Object.freeze({
  annotationsFromYahooWords,
  buildYahooRequest,
  requestWithInvalidParamsFallback,
});
