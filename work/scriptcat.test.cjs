/**
 * [INPUT]: 依赖 src/scriptcat.js Interface 与 GM 存储、浏览器交互内存 Adapter
 * [OUTPUT]: 验证远程授权复用已保存 Client ID，以及首次配置与正文发送确认的持久化
 * [POS]: work 的 ScriptCat Adapter 回归测试，保护用户配置和隐私确认流程
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createScriptCatAdapter } = require("../src/scriptcat");

test("远程授权直接复用已保存且确认过的 Client ID", async () => {
  const values = new Map([
    ["yahooClientId", "saved-client-id"],
    ["privacyAccepted", true],
  ]);
  const window = createWindow({
    prompt: () => {
      throw new Error("已保存 Client ID 时不应提示输入");
    },
    confirm: () => {
      throw new Error("已确认正文发送时不应重复确认");
    },
  });
  const platform = createAdapter(window, values);

  assert.equal(await platform.getRemoteAccess(), "saved-client-id");
});

test("首次远程授权保存 Client ID 与正文发送确认", async () => {
  const values = new Map();
  const alerts = [];
  const window = createWindow({
    prompt: () => "  new-client-id  ",
    confirm: () => true,
    alert: (message) => alerts.push(message),
  });
  const platform = createAdapter(window, values);

  assert.equal(await platform.getRemoteAccess(), "new-client-id");
  assert.equal(values.get("yahooClientId"), "new-client-id");
  assert.equal(values.get("privacyAccepted"), true);
  assert.deepEqual(alerts, ["Client ID 已保存"]);
});

function createAdapter(window, values) {
  return createScriptCatAdapter({
    window,
    getValue: (key, fallback) => values.get(key) ?? fallback,
    setValue: (key, value) => values.set(key, value),
    registerMenu: () => {},
  });
}

function createWindow(overrides) {
  return {
    localStorage: null,
    prompt: () => null,
    confirm: () => false,
    alert: () => {},
    ...overrides,
  };
}
