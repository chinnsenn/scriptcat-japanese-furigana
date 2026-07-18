/**
 * [INPUT]: 依赖可注入的当前时间、可取消异步等待与等待统计 Adapter
 * [OUTPUT]: 对外提供可取消 acquire、defer、snapshot，统一执行滚动窗口限流与远端退避
 * [POS]: reading 的请求调度 Module，被 engine.js 消费，集中守卫所有真实远程调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

function createRequestScheduler(limit, windowMs, options = {}) {
  if (!Number.isInteger(limit) || limit < 1 || windowMs < 1) {
    throw new RangeError("额度与时间窗口必须为正数");
  }

  const now = options.now || Date.now;
  const wait = options.wait || abortableWait;
  const onWait = options.onWait || (() => {});
  const timestamps = [];
  let blockedUntil = 0;
  let tail = Promise.resolve();

  function prune(current) {
    const cutoff = current - windowMs;
    while (timestamps.length > 0 && timestamps[0] <= cutoff) timestamps.shift();
  }

  function snapshot() {
    prune(now());
    const used = timestamps.length;
    return { limit, used, remaining: Math.max(0, limit - used) };
  }

  async function reserveSlot(signal) {
    while (true) {
      throwIfAborted(signal);
      const current = now();
      prune(current);
      const windowDelay =
        timestamps.length >= limit ? timestamps[0] + windowMs - current : 0;
      const delay = Math.max(blockedUntil - current, windowDelay, 0);
      if (delay > 0) {
        onWait(delay);
        await wait(delay, signal);
        continue;
      }
      timestamps.push(now());
      return snapshot();
    }
  }

  function acquire(signal) {
    const task = tail.then(() => reserveSlot(signal));
    tail = task.catch(() => undefined);
    return task;
  }

  function defer(delay) {
    if (!Number.isFinite(delay) || delay <= 0) return;
    blockedUntil = Math.max(blockedUntil, now() + delay);
  }

  return Object.freeze({ acquire, defer, snapshot });
}

function abortableWait(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(finish, delay);
    signal?.addEventListener("abort", cancel, { once: true });
    function finish() {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      reject(createAbortError());
    }
  });
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw createAbortError();
}

function createAbortError() {
  const error = new Error("操作已取消");
  error.name = "AbortError";
  return error;
}

module.exports = Object.freeze({ createRequestScheduler });
