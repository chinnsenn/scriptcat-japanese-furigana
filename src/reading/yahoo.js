/**
 * [INPUT]: 依赖 reading/core.js 的 Yahoo 请求描述与 ScriptCat GM_xmlhttpRequest 实现
 * [OUTPUT]: 对外提供 request(text, appId) 异步接口及结构化 Yahoo 错误
 * [POS]: reading 的远程 Adapter，隔离跨域请求、超时、HTTP 与 JSON-RPC 响应细节
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const { buildYahooRequest } = require("./core");

function createYahooAdapter({ request, onRequest = () => {} }) {
  if (typeof request !== "function") {
    throw new TypeError("Yahoo 适配器需要 GM_xmlhttpRequest");
  }

  function requestFurigana(text, appId) {
    const options = buildYahooRequest(appId, text);
    onRequest({ text, appId });
    return new Promise((resolve, reject) => {
      request({
        ...options,
        responseType: "json",
        timeout: 20_000,
        onload: (response) => handleResponse(response, resolve, reject),
        onerror(error) {
          reject(new Error(`Yahoo API 网络请求失败：${String(error)}`));
        },
        ontimeout() {
          reject(new Error("Yahoo API 请求超时"));
        },
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
  return new Error(
    `Yahoo API 返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`,
  );
}

function createYahooError(body) {
  const error = new Error(body.message || "Yahoo API 返回错误");
  error.code = body.code;
  error.data = body.data;
  return error;
}

module.exports = Object.freeze({ createYahooAdapter });
