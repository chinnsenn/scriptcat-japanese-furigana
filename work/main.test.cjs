/**
 * [INPUT]: 依赖 src/main.js 的顶层文档与 UI host 启动门禁
 * [OUTPUT]: 验证用户脚本不在 iframe 或已初始化页面重复创建浮动界面
 * [POS]: work 的组合根回归测试，保护单页面唯一注音会话
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { shouldStart } = require("../src/main");

const HOST_ID = "scriptcat-japanese-furigana-ui";

test("只在没有既有界面的顶层文档启动注音会话", () => {
  const topWindow = {};
  topWindow.top = topWindow;

  assert.equal(
    shouldStart({
      document: { getElementById: () => null },
      window: topWindow,
      hostId: HOST_ID,
    }),
    true,
  );
  assert.equal(
    shouldStart({
      document: { getElementById: () => ({ id: HOST_ID }) },
      window: topWindow,
      hostId: HOST_ID,
    }),
    false,
  );
});

test("iframe 不创建浮动界面", () => {
  assert.equal(
    shouldStart({
      document: { getElementById: () => null },
      window: { top: {} },
      hostId: HOST_ID,
    }),
    false,
  );
});
