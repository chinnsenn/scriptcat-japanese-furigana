/**
 * [INPUT]: 依赖 src/scriptcat.js Interface 与 GM 存储、浏览器交互内存 Adapter
 * [OUTPUT]: 验证默认采集范围、远程授权复用 Client ID，以及站点正文发送许可的隔离与撤销
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
    ["remoteAccessOrigins", ["https://reader.example"]],
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
  assert.deepEqual(values.get("remoteAccessOrigins"), ["https://reader.example"]);
  assert.deepEqual(alerts, ["Client ID 已保存"]);
});

test("首次正文发送确认展示真实范围、字符数与受限摘要", async () => {
  const values = new Map([["yahooClientId", "saved-client-id"]]);
  let confirmation = "";
  const window = createWindow({
    confirm: (message) => {
      confirmation = message;
      return true;
    },
  });
  const platform = createAdapter(window, values);

  await platform.getRemoteAccess({ scope: "selection", sample: "東京 の 選択本文" });

  assert.match(confirmation, /范围：选中文本/);
  assert.match(confirmation, /首个未缓存片段：9 字/);
  assert.match(confirmation, /東京 の 選択本文/);
});

test("正文发送许可按站点隔离并可撤销当前站点", async () => {
  const values = new Map([
    ["yahooClientId", "saved-client-id"],
    ["remoteAccessOrigins", ["https://reader.example"]],
  ]);
  let confirmations = 0;
  const menus = new Map();
  const window = createWindow({
    origin: "https://news.example",
    confirm: () => {
      confirmations += 1;
      return true;
    },
  });
  const platform = createAdapter(window, values, (label, callback) => {
    menus.set(label, callback);
  });

  assert.equal(await platform.getRemoteAccess(), "saved-client-id");
  assert.equal(confirmations, 1);
  assert.deepEqual(values.get("remoteAccessOrigins"), [
    "https://reader.example",
    "https://news.example",
  ]);

  platform.registerMenus({ onVisibilityChange: async () => {} });
  await menus.get("撤销当前站点正文发送许可")();
  assert.deepEqual(values.get("remoteAccessOrigins"), ["https://reader.example"]);
});

test("脚本菜单保存三种默认标注范围并对异常存储回落到正文区域", async () => {
  const values = new Map([["defaultScope", "unknown"]]);
  const menus = new Map();
  const alerts = [];
  const window = createWindow({
    prompt: () => "1",
    alert: (message) => alerts.push(message),
  });
  const platform = createAdapter(window, values, (label, callback) => {
    menus.set(label, callback);
  });

  assert.equal(await platform.getDefaultScope(), "main");
  platform.registerMenus({ onVisibilityChange: async () => {} });
  await menus.get("设置默认标注范围")();

  assert.equal(values.get("defaultScope"), "selection");
  assert.equal(await platform.getDefaultScope(), "selection");
  assert.deepEqual(alerts, ["默认标注范围已设为：选中文本"]);
});

test("自动标注白名单按站点隔离并可从菜单切换", async () => {
  const values = new Map();
  const menus = new Map();
  const readerWindow = createWindow({ origin: "https://reader.example" });
  const newsWindow = createWindow({ origin: "https://news.example" });
  const reader = createAdapter(readerWindow, values, (label, callback) => {
    menus.set(label, callback);
  });
  const news = createAdapter(newsWindow, values);

  reader.registerMenus({
    onClearCache: () => 0,
    onRetryFailures: () => {},
    onVisibilityChange: () => {},
  });
  await menus.get("切换当前站点自动标注")();

  assert.equal(await reader.isAutoAnnotateEnabled(), true);
  assert.equal(await news.isAutoAnnotateEnabled(), false);
  assert.deepEqual(values.get("autoAnnotateOrigins"), ["https://reader.example"]);
});

test("发送审计只展示真实远程请求并可从菜单清理当前站点缓存", async () => {
  const values = new Map();
  const menus = new Map();
  const alerts = [];
  let clears = 0;
  const window = createWindow({ alert: (message) => alerts.push(message) });
  const platform = createAdapter(window, values, (label, callback) => {
    menus.set(label, callback);
  });
  platform.registerMenus({
    onClearCache: () => {
      clears += 1;
      return 3;
    },
    onRetryFailures: () => {},
    onVisibilityChange: () => {},
  });

  platform.resetRemoteLog("main");
  platform.recordRemoteRequest("東京の本文");
  platform.recordRemoteRequest("大阪の本文");
  menus.get("查看本次实际发送范围")();
  await menus.get("清理当前站点读音缓存")();

  assert.match(alerts[0], /范围：正文区域/);
  assert.match(alerts[0], /实际请求：2 次 \/ 10 字/);
  assert.match(alerts[0], /東京の本文/);
  assert.equal(clears, 1);
  assert.equal(alerts[1], "已清理当前站点 3 个读音缓存条目");
});

function createAdapter(window, values, registerMenu = () => {}) {
  return createScriptCatAdapter({
    window,
    getValue: (key, fallback) => values.get(key) ?? fallback,
    setValue: (key, value) => values.set(key, value),
    registerMenu,
  });
}

function createWindow(overrides) {
  return {
    location: { origin: overrides.origin || "https://reader.example" },
    localStorage: null,
    prompt: () => null,
    confirm: () => false,
    alert: () => {},
    ...overrides,
  };
}
