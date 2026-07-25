/**
 * [INPUT]: 依赖浏览器 document/window、站点级开关读取器与 HTMLVideoElement 播放 Interface
 * [OUTPUT]: 对外提供 createVideoFocusGuard，阻止启用站点在失焦/隐藏后由页面脚本自动暂停视频
 * [POS]: media 的视频焦点守卫 Module，独立于注音会话，接管视频生命周期信号与可见性伪装
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const FOCUS_SIGNALS = Object.freeze([
  ["document", "visibilitychange"],
  ["document", "webkitvisibilitychange"],
  ["window", "blur"],
  ["window", "pagehide"],
  ["window", "freeze"],
]);
const USER_ACTIONS = Object.freeze([
  "pointerdown",
  "mousedown",
  "touchstart",
  "keydown",
]);
const RESTORE_DELAYS = Object.freeze([0, 40, 160, 600]);
const USER_ACTION_WINDOW_MS = 1_500;
const FOCUS_SIGNAL_WINDOW_MS = 8_000;

function createVideoFocusGuard({
  window,
  document,
  isEnabled,
  onWarning = () => {},
  now = () => Date.now(),
}) {
  const videos = new Set();
  const tracked = new WeakSet();
  const states = new WeakMap();
  const listeners = [];
  const patches = [];
  let enabled = false;
  let installed = false;
  let observer = null;
  let lastUserActionAt = -Infinity;
  let lastFocusSignalAt = -Infinity;

  async function start() {
    return setEnabled(await Promise.resolve(isEnabled()));
  }

  function setEnabled(next) {
    enabled = Boolean(next);
    if (enabled) install();
    else uninstall();
    return enabled;
  }

  function install() {
    if (installed) return;
    installed = true;
    patchVisibility();
    addListeners();
    scanVideos(document);
    observeVideos();
  }

  function uninstall() {
    if (!installed) return;
    installed = false;
    disconnectObserver();
    removeListeners();
    restorePatches();
    videos.clear();
  }

  function addListeners() {
    if (listeners.length > 0) return;
    for (const eventName of USER_ACTIONS) {
      listen(document, eventName, recordUserAction);
      listen(window, eventName, recordUserAction);
    }
    for (const [targetName, eventName] of FOCUS_SIGNALS) {
      listen(targetName === "window" ? window : document, eventName, handleFocusSignal);
    }
    listen(document, "play", handleVideoPlay);
    listen(document, "playing", handleVideoPlay);
    listen(document, "pause", handleVideoPause);
  }

  function listen(target, eventName, callback) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(eventName, callback, true);
    listeners.push([target, eventName, callback]);
  }

  function removeListeners() {
    for (const [target, eventName, callback] of listeners) {
      target.removeEventListener(eventName, callback, true);
    }
    listeners.length = 0;
  }

  function recordUserAction() {
    lastUserActionAt = now();
  }

  function handleFocusSignal(event) {
    if (!enabled) return;
    lastFocusSignalAt = now();
    rememberPlayingVideos();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    } else if (typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
    restorePausedVideos();
  }

  function handleVideoPlay(event) {
    const video = event.target;
    if (!isVideo(video)) return;
    trackVideo(video);
    stateOf(video).wasPlaying = true;
  }

  function handleVideoPause(event) {
    const video = event.target;
    if (!enabled || !isVideo(video)) return;
    trackVideo(video);
    if (shouldRestore(video)) scheduleRestore(video);
  }

  function shouldRestore(video) {
    const state = stateOf(video);
    return (
      state.wasPlaying &&
      !state.restoring &&
      !video.ended &&
      now() - lastUserActionAt > USER_ACTION_WINDOW_MS &&
      now() - lastFocusSignalAt <= FOCUS_SIGNAL_WINDOW_MS
    );
  }

  function rememberPlayingVideos() {
    for (const video of videos) {
      if (!video.paused && !video.ended) stateOf(video).wasPlaying = true;
    }
  }

  function restorePausedVideos() {
    for (const video of videos) {
      if (video.paused && shouldRestore(video)) scheduleRestore(video);
    }
  }

  function scheduleRestore(video) {
    for (const delay of RESTORE_DELAYS) {
      window.setTimeout(() => restoreVideo(video), delay);
    }
  }

  function restoreVideo(video) {
    if (!enabled || !video.isConnected || !video.paused || video.ended) return;
    const state = stateOf(video);
    state.restoring = true;
    Promise.resolve()
      .then(() => video.play())
      .catch(onWarning)
      .finally(() => {
        state.restoring = false;
      });
  }

  function trackVideo(video) {
    if (tracked.has(video)) return;
    tracked.add(video);
    videos.add(video);
    stateOf(video).wasPlaying = !video.paused && !video.ended;
  }

  function stateOf(video) {
    let state = states.get(video);
    if (!state) {
      state = { wasPlaying: false, restoring: false };
      states.set(video, state);
    }
    return state;
  }

  function scanVideos(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    if (isVideo(root)) trackVideo(root);
    for (const video of root.querySelectorAll("video")) trackVideo(video);
  }

  function observeVideos() {
    if (observer || typeof window.MutationObserver !== "function") return;
    const root = document.documentElement || document.body;
    if (!root) return;
    observer = new window.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) scanVideos(node);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function disconnectObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  function patchVisibility() {
    patchGetter(document, "hidden", false);
    patchGetter(document, "webkitHidden", false);
    patchGetter(document, "visibilityState", "visible");
    patchGetter(document, "webkitVisibilityState", "visible");
    patchMethod(document, "hasFocus", () => true);
  }

  function patchGetter(object, name, value) {
    patchProperty(object, name, {
      configurable: true,
      get: () => value,
    });
  }

  function patchMethod(object, name, method) {
    patchProperty(object, name, {
      configurable: true,
      value: method,
    });
  }

  function patchProperty(object, name, descriptor) {
    const target = findPropertyOwner(object, name) || object;
    try {
      patches.push({
        target,
        name,
        descriptor: Object.getOwnPropertyDescriptor(target, name),
      });
      Object.defineProperty(target, name, descriptor);
    } catch (error) {
      patches.pop();
      onWarning(error);
    }
  }

  function restorePatches() {
    while (patches.length > 0) {
      const patch = patches.pop();
      try {
        if (patch.descriptor) Object.defineProperty(patch.target, patch.name, patch.descriptor);
        else delete patch.target[patch.name];
      } catch (error) {
        onWarning(error);
      }
    }
  }

  return Object.freeze({ setEnabled, start });
}

function findPropertyOwner(object, name) {
  for (let target = object; target; target = Object.getPrototypeOf(target)) {
    if (Object.prototype.hasOwnProperty.call(target, name)) return target;
  }
  return null;
}

function isVideo(node) {
  return Boolean(node && node.tagName === "VIDEO" && typeof node.play === "function");
}

module.exports = Object.freeze({ createVideoFocusGuard });
