# ScriptCat 日语网页汉字注音

为日语网页中的汉字添加上下文相关读音的 ScriptCat 用户脚本。脚本使用 Yahoo! JAPAN ルビ振り API 分析正文，并通过标准 `<ruby>` 元素写回页面。

## 功能

- 自动识别日语页面，提供“标注读音 / 已完成标注”双状态按钮。
- 可从脚本菜单选择选中文本、正文区域或整页作为默认标注范围。
- 跨内联元素的词语使用连续 ruby，原有元素身份、样式与事件保持有效。
- 支持鼠标和触摸拖动，松手后自动吸附最近屏幕边缘。
- 优先读取内存与 `localStorage` 缓存，正文变化或缓存缺失时才调用 API。
- 正文发送许可按网站 origin 独立保存，可从脚本菜单撤销当前站点许可。
- 自动标注白名单按 origin 隔离，白名单页面加载后使用默认范围持续注音。
- 首次发送确认展示范围和首片段摘要；菜单可查看本次真实远程请求、清理当前站点缓存。
- 远程请求遵守每分钟 300 次滚动窗口，Yahoo 429 响应按服务端建议自动退避。
- 处理按钮实时显示段落进度，再次点击会取消调度等待和远程请求。
- 网络、超时与 5xx 瞬时错误指数退避；最终失败片段可从脚本菜单单独重试。
- 对 Yahoo `Invalid params` 自动缩小文本块重试，局部异常不会终止整页。
- Hover 面板展示处理进度、标注字数、API 调用、缓存命中、限流等待、重试、耗时与失败片段。
- 支持撤销注音、SPA 导航、无限滚动、文本改写、局部重渲染与窗口尺寸变化。

## 安装

1. 在 ScriptCat 中新建普通用户脚本。
2. 复制 [outputs/japanese-furigana.user.js](outputs/japanese-furigana.user.js) 的全部内容并保存。
3. 打开日语网页，通过脚本菜单配置 Yahoo! JAPAN Developer Network Client ID。
4. 点击页面右下角的“标注读音”。

详细配置、隐私说明与已知边界见 [使用说明](outputs/README.md)。

## 开发与验证

```bash
npm install
npm run check
```

源码按 `reading/page/scriptcat/main` 领域 Module 维护，`main` 只负责组合 Adapter 与启动；esbuild 生成 `outputs/japanese-furigana.user.js` 单文件安装产物。测试通过 Module Interface 覆盖读音分析、注音会话、UTF-8 分块、API 降级、缓存、额度和按钮吸边；`work/smoke.html` 提供浏览器端冒烟场景。

## 自动发布

GitHub Actions 在 Pull Request 与 `main` push 上执行锁定依赖安装、`npm run check` 和生成产物一致性校验。推送与 `package.json` 版本一致的 `v*` 标签后，工作流创建 GitHub Release，并附加 `outputs/japanese-furigana.user.js` 安装文件。

```bash
git tag v1.0.0
git push origin main v1.0.0
```

Greasy Fork 与 GitHub Webhook 只需配置一次：

1. 在 Greasy Fork 从 [`outputs/japanese-furigana.user.js` Raw URL](https://raw.githubusercontent.com/chinnsenn/scriptcat-japanese-furigana/main/outputs/japanese-furigana.user.js) 导入脚本，并在脚本管理页开启代码同步。
2. 在 Greasy Fork 的 Webhook 设置中复制该脚本专属的 Payload URL 与 Secret。
3. 打开 GitHub 仓库 `Settings → Webhooks → Add webhook`，填入 Payload URL，内容类型选择 `application/json`，填入 Secret，仅启用 Push 事件并保持 SSL 验证和 Active。
4. 在 GitHub 的 Recent deliveries 确认响应成功，并在 Greasy Fork 版本页确认版本同步。建议把本工作流设为 `main` 分支必需检查，让 Webhook 只看到已验证的生成产物。

Webhook Secret 只保存在 GitHub Webhook 配置中，仓库与 Actions 均不保存该值。GitHub 的 Webhook 创建与安全建议见[官方文档](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks)；Greasy Fork 的同步实现以[官方开源仓库](https://github.com/greasyfork-org/greasyfork)为准。

## 隐私

缓存命中的文本保留在当前网站域名的 `localStorage`。缓存缺失的合格可见正文会分段发送到 Yahoo! JAPAN ルビ振り API；首次授权会展示范围和摘要，真实请求可从菜单审计。脚本会跳过导航、页眉页脚、侧栏、表单、代码块、可编辑区域、隐藏区域和已有注音。
