/**
 * [INPUT]: 依赖 src/media/guard.js Interface、jsdom DOM 事件与可控 HTMLVideoElement 播放桩
 * [OUTPUT]: 验证视频防暂停的失焦恢复、用户暂停保留、动态 video 追踪、可见性伪装与关闭恢复
 * [POS]: work 的 media Module 回归测试，保护站点级视频行为守卫的核心判定
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { createVideoFocusGuard } = require("../src/media/guard");

test("失焦后页面脚本暂停正在播放的视频会自动恢复", async () => {
  let clock = 0;
  const dom = createDom();
  const video = createVideo(dom.window);
  dom.window.document.body.append(video);
  const guard = createVideoFocusGuard({
    document: dom.window.document,
    window: dom.window,
    isEnabled: () => true,
    now: () => clock,
  });

  await guard.start();
  await video.play();
  clock += 100;
  dom.window.dispatchEvent(new dom.window.Event("blur"));
  video.pause();
  await wait(20);

  assert.equal(video.paused, false);
  assert.equal(video.playCalls, 2);
});

test("用户刚操作过的暂停保持暂停状态", async () => {
  let clock = 0;
  const dom = createDom();
  const video = createVideo(dom.window);
  dom.window.document.body.append(video);
  const guard = createVideoFocusGuard({
    document: dom.window.document,
    window: dom.window,
    isEnabled: () => true,
    now: () => clock,
  });

  await guard.start();
  await video.play();
  clock += 100;
  dom.window.dispatchEvent(new dom.window.Event("blur"));
  clock += 100;
  dom.window.document.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
  video.pause();
  await wait(20);

  assert.equal(video.paused, true);
  assert.equal(video.playCalls, 1);
});

test("动态插入的视频也会被追踪并恢复失焦暂停", async () => {
  let clock = 0;
  const dom = createDom();
  const guard = createVideoFocusGuard({
    document: dom.window.document,
    window: dom.window,
    isEnabled: () => true,
    now: () => clock,
  });

  await guard.start();
  const video = createVideo(dom.window);
  dom.window.document.body.append(video);
  await wait(0);
  await video.play();
  clock += 100;
  dom.window.dispatchEvent(new dom.window.Event("blur"));
  video.pause();
  await wait(20);

  assert.equal(video.paused, false);
  assert.equal(video.playCalls, 2);
});

test("开关关闭后恢复原始可见性属性并停止恢复暂停", async () => {
  let clock = 0;
  const dom = createDom();
  const document = dom.window.document;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => true,
  });
  const video = createVideo(dom.window);
  document.body.append(video);
  const guard = createVideoFocusGuard({
    document,
    window: dom.window,
    isEnabled: () => true,
    now: () => clock,
  });

  await guard.start();
  assert.equal(document.hidden, false);

  guard.setEnabled(false);
  assert.equal(document.hidden, true);

  await video.play();
  clock += 100;
  dom.window.dispatchEvent(new dom.window.Event("blur"));
  video.pause();
  await wait(20);

  assert.equal(video.paused, true);
  assert.equal(video.playCalls, 1);
});

function createDom() {
  return new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "https://video.example/watch",
  });
}

function createVideo(window) {
  const video = window.document.createElement("video");
  let paused = true;
  Object.defineProperty(video, "paused", {
    configurable: true,
    get: () => paused,
  });
  Object.defineProperty(video, "ended", {
    configurable: true,
    get: () => false,
  });
  video.playCalls = 0;
  video.play = () => {
    video.playCalls += 1;
    paused = false;
    video.dispatchEvent(new window.Event("play", { bubbles: true }));
    return Promise.resolve();
  };
  video.pause = () => {
    paused = true;
    video.dispatchEvent(new window.Event("pause", { bubbles: true }));
  };
  return video;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
