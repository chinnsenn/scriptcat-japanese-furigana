/**
 * [INPUT]: 读取 package.json、scripts/build.cjs 与 .github/workflows/release.yml 发布契约
 * [OUTPUT]: 验证 1.0 元数据、Raw 更新地址、CI 质量门和标签 Release 产物路径
 * [POS]: work 的发布链路静态回归，阻止版本、构建产物与 GitHub 自动化静默漂移
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const packageJson = require("../package.json");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

test("1.0 发布元数据指向正式 GitHub 仓库与可安装 Raw 产物", () => {
  const userscript = fs.readFileSync(
    path.join(root, "outputs/japanese-furigana.user.js"),
    "utf8",
  );

  assert.equal(packageJson.version, "1.0.0");
  assert.match(userscript, /^\/\/ @version\s+1\.0\.0$/m);
  assert.match(userscript, /@homepageURL\s+https:\/\/github\.com\/chinnsenn\/scriptcat-japanese-furigana/);
  assert.match(userscript, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/chinnsenn\/scriptcat-japanese-furigana\/main\/outputs\/japanese-furigana\.user\.js/);
});

test("GitHub 工作流验证生成产物并仅用匹配版本标签发布", () => {
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /git diff --exit-code -- outputs\/japanese-furigana\.user\.js/);
  assert.match(workflow, /require\('\.\/package\.json'\)\.version/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /gh release upload .*outputs\/japanese-furigana\.user\.js/);
  assert.match(readme, /raw\.githubusercontent\.com\/chinnsenn\/scriptcat-japanese-furigana\/main\/outputs\/japanese-furigana\.user\.js/);
  assert.match(readme, /Payload URL/);
  assert.match(readme, /application\/json/);
  assert.match(readme, /仅启用 Push 事件/);
});
