/**
 * [INPUT]: 依赖 src/text.js、src/reading 与 src/page/ui.js 的纯算法 Interface 和 Node 内置测试器
 * [OUTPUT]: 验证拖拽吸边、双状态按钮、缓存、额度、Yahoo Adapter、日语识别、分块降级与读音对齐
 * [POS]: work 的回归测试，约束用户脚本中与浏览器无关的核心算法
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  annotationsFromYahooWords,
  buildYahooRequest,
  requestWithInvalidParamsFallback,
} = require("../src/reading/core");
const {
  hasKanji,
  isJapaneseText,
  splitByUtf8Bytes,
  utf8Length,
} = require("../src/text");
const {
  createLruCache,
  createPersistentCache,
  createRollingQuota,
} = require("../src/reading/cache");
const { calculateDockPosition, formatButtonLabel } = require("../src/page/ui");
const { createYahooAdapter } = require("../src/reading/yahoo");

test("拖动结束后吸附最近边缘并限制在视口内", () => {
  const viewport = { viewportWidth: 1_000, viewportHeight: 800 };
  const size = { width: 104, height: 38 };

  assert.deepEqual(
    calculateDockPosition({ left: 430, top: 18, ...size, ...viewport, margin: 12 }),
    { edge: "top", left: 430, top: 12, ratio: 418 / 872 },
  );
  assert.deepEqual(
    calculateDockPosition({ left: 880, top: 400, ...size, ...viewport, margin: 12 }),
    { edge: "right", left: 884, top: 400, ratio: 388 / 738 },
  );
  assert.deepEqual(
    calculateDockPosition({ left: -30, top: 780, ...size, ...viewport, margin: 12 }),
    { edge: "left", left: 12, top: 750, ratio: 1 },
  );
});

test("LRU 缓存淘汰最久未使用项并刷新命中项热度", () => {
  const cache = createLruCache(2);
  cache.set("a", 1);
  cache.set("b", 2);

  assert.equal(cache.get("a"), 1);
  cache.set("c", 3);

  assert.equal(cache.has("a"), true);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.size, 2);
});

test("滚动额度在请求后扣减并在 60 秒后恢复", () => {
  const quota = createRollingQuota(3, 60_000);

  assert.deepEqual(quota.snapshot(1_000), { limit: 3, used: 0, remaining: 3 });
  quota.record(1_000);
  quota.record(2_000);
  assert.deepEqual(quota.snapshot(3_000), { limit: 3, used: 2, remaining: 1 });

  quota.record(3_000);
  quota.record(4_000);
  assert.deepEqual(quota.snapshot(4_000), { limit: 3, used: 4, remaining: 0 });
  assert.deepEqual(quota.snapshot(61_000), { limit: 3, used: 3, remaining: 0 });
  assert.deepEqual(quota.snapshot(62_000), { limit: 3, used: 2, remaining: 1 });
});

test("按钮仅显示待标注与已完成两个状态", () => {
  assert.equal(formatButtonLabel(false), "标注读音");
  assert.equal(formatButtonLabel(true), "已完成标注");
});

test("localStorage 缓存优先返回相同文本并让变化文本失效", () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  const cache = createPersistentCache(storage, {
    prefix: "test-cache",
    maxEntries: 2,
    maxAgeMs: 1_000,
  });
  const words = [{ surface: "漢字", furigana: "かんじ" }];

  assert.equal(cache.get("漢字", 100), undefined);
  assert.equal(cache.set("漢字", words, 100), true);
  assert.deepEqual(cache.get("漢字", 500), words);
  assert.equal(cache.get("漢字が変化", 500), undefined);
  assert.equal(cache.get("漢字", 1_100), undefined);
});

test("localStorage 缓存超过容量时淘汰最早条目", () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  const cache = createPersistentCache(storage, {
    prefix: "bounded-cache",
    maxEntries: 2,
    maxAgeMs: 10_000,
  });

  cache.set("一", [{ surface: "一" }], 1);
  cache.set("二", [{ surface: "二" }], 2);
  cache.set("三", [{ surface: "三" }], 3);

  assert.equal(cache.get("一", 4), undefined);
  assert.deepEqual(cache.get("二", 4), [{ surface: "二" }]);
  assert.deepEqual(cache.get("三", 4), [{ surface: "三" }]);
});

test("通过官方 appid 参数传递 Client ID", () => {
  const request = buildYahooRequest("client+/=id", "漢字");

  assert.equal(
    request.url,
    "https://jlp.yahooapis.jp/jsonrpc?appid=client%2B%2F%3Did",
  );
  assert.equal(request.headers["Content-Type"], "application/json");
  assert.equal("User-Agent" in request.headers, false);
  assert.equal(JSON.parse(request.data).params.q, "漢字");
});

test("Yahoo 适配器解析成功响应并记录一次真实调用", async () => {
  let requestOptions;
  let callCount = 0;
  const adapter = createYahooAdapter({
    request(options) {
      requestOptions = options;
      options.onload({
        status: 200,
        response: { result: { word: [{ surface: "漢字", furigana: "かんじ" }] } },
      });
    },
    onRequest() {
      callCount += 1;
    },
  });

  const words = await adapter.request("漢字", "client-id");

  assert.equal(callCount, 1);
  assert.equal(requestOptions.timeout, 20_000);
  assert.deepEqual(words, [{ surface: "漢字", furigana: "かんじ" }]);
});

test("Yahoo 适配器保留 JSON-RPC 错误码供自适应降级判断", async () => {
  const adapter = createYahooAdapter({
    request(options) {
      options.onload({
        status: 200,
        response: { error: { code: -32602, message: "Invalid params" } },
      });
    },
  });

  await assert.rejects(adapter.request("漢字", "client-id"), (error) => {
    assert.equal(error.code, -32602);
    assert.match(error.message, /Invalid params/);
    return true;
  });
});

test("Invalid params 时缩小文本块并保留全部可解析片段", async () => {
  const input = "今日は東京へ行きます。漢字の読み方を確認します。";
  const calls = [];
  const request = async (text) => {
    calls.push(text);
    if (utf8Length(text) > 24) {
      const error = new Error("Invalid params");
      error.code = -32602;
      throw error;
    }
    return [{ surface: text }];
  };

  const responses = await requestWithInvalidParamsFallback(input, request, {
    minimumBytes: 24,
  });

  assert.equal(responses.map((response) => response.text).join(""), input);
  assert.ok(responses.every((response) => response.words.length === 1));
  assert.ok(calls.length > responses.length);
});

test("最小片段仍然 Invalid params 时仅标记该片段为跳过", async () => {
  const responses = await requestWithInvalidParamsFallback(
    "𠮷野家",
    async () => {
      const error = new Error("Invalid params");
      error.code = -32602;
      throw error;
    },
    { minimumBytes: 24 },
  );

  assert.equal(responses.length, 1);
  assert.equal(responses[0].text, "𠮷野家");
  assert.equal(responses[0].skipped, true);
  assert.deepEqual(responses[0].words, []);
});

test("网络错误直接上抛", async () => {
  await assert.rejects(
    requestWithInvalidParamsFallback("漢字", async () => {
      throw new Error("network down");
    }),
    /network down/,
  );
});

test("识别包含足够假名的日语文本", () => {
  const japanese = "今日は東京へ行きます。これは日本語の文章です。漢字の読み方をページに表示します。";
  const chinese = "今天去东京。这是一段中文文本，其中同样包含大量汉字。";

  assert.equal(isJapaneseText(japanese), true);
  assert.equal(isJapaneseText(chinese), false);
  assert.equal(hasKanji(japanese), true);
});

test("按 UTF-8 字节数分块并完整保留 Unicode 文本", () => {
  const input = "今日は晴れです。😀明日は東京へ行きます。漢字を読みます。";
  const chunks = splitByUtf8Bytes(input, 24);

  assert.equal(chunks.map((chunk) => chunk.text).join(""), input);
  assert.ok(chunks.every((chunk) => utf8Length(chunk.text) <= 24));
  assert.ok(chunks.every((chunk) => !chunk.text.includes("�")));
  assert.deepEqual(
    chunks.map((chunk) => input.slice(chunk.start, chunk.end)),
    chunks.map((chunk) => chunk.text),
  );
});

test("将 Yahoo 词与子词结果转换为准确文本区间", () => {
  const input = "漢字かな交じり文にふりがなを振ること。";
  const words = [
    { surface: "漢字", furigana: "かんじ" },
    {
      surface: "かな交じり",
      furigana: "かなまじり",
      subword: [
        { surface: "かな", furigana: "かな" },
        { surface: "交", furigana: "ま" },
        { surface: "じり", furigana: "じり" },
      ],
    },
    { surface: "文", furigana: "ぶん" },
    { surface: "に" },
    { surface: "ふりがな" },
    { surface: "を" },
    {
      surface: "振る",
      furigana: "ふる",
      subword: [
        { surface: "振", furigana: "ふ" },
        { surface: "る", furigana: "る" },
      ],
    },
    { surface: "こと" },
    { surface: "。" },
  ];

  assert.deepEqual(
    annotationsFromYahooWords(input, words).map(({ base, reading }) => [base, reading]),
    [
      ["漢字", "かんじ"],
      ["交", "ま"],
      ["文", "ぶん"],
      ["振", "ふ"],
    ],
  );
});

test("对齐失败时保守跳过结果", () => {
  const annotations = annotationsFromYahooWords("東京へ行く", [
    { surface: "大阪", furigana: "おおさか" },
    { surface: "東京", furigana: "とうきょう" },
  ]);

  assert.deepEqual(annotations.map(({ base, reading }) => [base, reading]), [
    ["東京", "とうきょう"],
  ]);
});
