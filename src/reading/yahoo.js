/**
 * [INPUT]: 依赖 reading/core.js 的 Yahoo 请求描述、AbortSignal 与 ScriptCat GM_xmlhttpRequest 实现
 * [OUTPUT]: 对外提供可取消 request(text, appId, options) 及带 HTTP 状态、Retry-After、瞬时标记的错误
 * [POS]: reading 的远程 Adapter，隔离跨域请求、超时、HTTP 与 JSON-RPC 响应细节
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const { buildYahooRequest } = require("./core");

function createYahooAdapter({ request, onRequest = () => {} }) {
  if (typeof request !== "function") {
    throw new TypeError("Yahoo 适配器需要 GM_xmlhttpRequest");
  }

  function requestFurigana(text, appId, { signal } = {}) {
    const options = buildYahooRequest(appId, text);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }
      onRequest({ text, appId });
      let settled = false;
      let task;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        callback(value);
      };
      const abort = () => {
        task?.abort?.();
        finish(reject, createAbortError());
      };
      signal?.addEventListener("abort", abort, { once: true });
      task = request({
        ...options,
        responseType: "json",
        timeout: 20_000,
        onload: (response) =>
          handleResponse(
            response,
            (value) => finish(resolve, value),
            (error) => finish(reject, error),
          ),
        onerror(error) {
          finish(reject, createTransientError(`Yahoo API 网络请求失败：${String(error)}`));
        },
        ontimeout() {
          finish(reject, createTransientError("Yahoo API 请求超时"));
        },
        onabort: () => finish(reject, createAbortError()),
      });
    });
  }

  return Object.freeze({ request: requestFurigana });
}

function handleResponse(response, resolve, reject) {
  if (response.status < 200 || response.status >= 300) {
    reject(createHttpError(response));
    return;
  }
  try {
    const body = response.response || JSON.parse(response.responseText);
    if (body.error) {
      reject(createYahooError(body.error));
      return;
    }
    resolve(body.result && Array.isArray(body.result.word) ? body.result.word : []);
  } catch (error) {
    reject(new Error(`Yahoo API 响应解析失败：${error.message}`));
  }
}

function createHttpError(response) {
  const responseBody =
    response.responseText ||
    (response.response ? JSON.stringify(response.response) : "");
  const detail = responseBody.slice(0, 500);
  const error = new Error(
    `Yahoo API 返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`,
  );
  error.status = response.status;
  error.retryAfterMs = parseRetryAfter(response.responseHeaders);
  error.transient = response.status >= 500 || [408, 425].includes(response.status);
  return error;
}

function createTransientError(message) {
  const error = new Error(message);
  error.transient = true;
  return error;
}

function createAbortError() {
  const error = new Error("Yahoo API 请求已取消");
  error.name = "AbortError";
  return error;
}

function parseRetryAfter(headers) {
  const match = String(headers || "").match(/^retry-after:\s*(.+)$/im);
  if (!match) return undefined;
  const seconds = Number(match[1]);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const timestamp = Date.parse(match[1]);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function createYahooError(body) {
  const error = new Error(body.message || "Yahoo API 返回错误");
  error.code = body.code;
  error.data = body.data;
  return error;
}

module.exports = Object.freeze({ createYahooAdapter });
