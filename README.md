# Japanese Furigana for Web Pages

为日语网页汉字添加上下文相关读音的 ScriptCat 用户脚本。脚本通过 Yahoo! JAPAN ルビ振り API 分析合格正文，再以标准 `<ruby>` 元素写回页面。

[Greasy Fork 安装页](https://greasyfork.org/scripts/587522) · [GitHub Release](https://github.com/chinnsenn/scriptcat-japanese-furigana/releases/latest) · [安装脚本 Raw](https://raw.githubusercontent.com/chinnsenn/scriptcat-japanese-furigana/main/outputs/japanese-furigana.user.js) · [问题反馈](https://github.com/chinnsenn/scriptcat-japanese-furigana/issues)

## 产品定位

这个脚本专注于网页汉字注音。阅读者可以对选中文本、正文区域或整页添加读音，并在同一页面持续维护注音状态。词典、翻译、学习记录、测验、账户与云同步保持在产品范围之外。

## 核心能力

| 能力 | 行为 |
| --- | --- |
| 精准采集 | 支持选中文本、正文区域、整页；跳过导航、页眉页脚、侧栏、表单、代码、可编辑区域、隐藏内容与已有 ruby |
| 安全标注 | 保留网页结构、样式、事件和原始元素身份；连续内联节点中的词语可形成一个 ruby；点击完成状态即可完整撤销 |
| 动态维护 | 覆盖 SPA 导航、无限滚动、文本节点改写、局部重渲染与窗口尺寸变化 |
| 稳定分析 | 双层缓存、每分钟 300 次滚动限流、429 退避、瞬时错误重试、局部失败保留、取消与失败片段重试 |
| 隐私控制 | 每个站点独立许可和自动标注白名单；可查看真实发送摘要、清理当前站点缓存、撤销许可；Client ID 始终由用户管理 |

## 安装与首次使用

1. 安装 ScriptCat 或兼容的用户脚本管理器。
2. 打开 [Greasy Fork 数字链接](https://greasyfork.org/scripts/587522) 并安装脚本。
3. 在脚本菜单选择“设置 Yahoo Client ID”，输入自己的 Yahoo! JAPAN Developer Network Client ID。
4. 打开日语网页，点击页面边缘的圆形注音图标。
5. 首次产生远程请求时，核对站点、采集范围、字符数与摘要，再确认当前站点许可。

Yahoo 官方要求请求携带 Client ID；接口细节见 [ルビ振り API V2](https://developer.yahoo.co.jp/webapi/jlp/furigana/v2/furigana.html)。

## 圆形按钮

按钮使用“上方读音点 + 下方字形骨架”的抽象图标，页面内保持无文字呈现。辅助技术可通过动态 `aria-label` 读取完整状态。

| 状态 | 视觉反馈 | 点击行为 |
| --- | --- | --- |
| 待标注 | 米白字形印章 | 开始当前范围的注音 |
| 处理中 | 金色环形进度与呼吸读音点 | 立即取消调度等待和远程请求 |
| 已完成 | 松绿色印章 | 移除脚本生成的全部 ruby，恢复原始页面 |

按钮支持鼠标与触摸拖动，松手后吸附最近屏幕边缘，并以“边缘 + 相对位置”跨页面保存布局。悬停或键盘聚焦会展开诊断面板。

## 脚本菜单

- `设置 Yahoo Client ID`：保存、替换或清除用户自己的 Client ID。
- `切换按钮强制显示`：控制非日语页面上的按钮可见性。
- `撤销当前站点正文发送许可`：清除当前 origin 的远程发送授权。
- `设置默认标注范围`：选择选中文本、正文区域或整页。
- `重试失败片段`：只重新分析当前会话最终失败的片段。
- `切换当前站点自动标注`：管理按 origin 隔离的自动标注白名单。
- `清理当前站点读音缓存`：清理当前引擎内存条目与当前 origin 的持久缓存。
- `查看本次实际发送范围`：显示真实进入 Yahoo 请求的次数、字符数和受限摘要。

## 采集、标注与撤销

脚本按块级正文建立稳定文本区间，并把 API 返回结果映射回原始文本节点。选中文本只处理 Range 覆盖的字符；正文区域优先使用 `main`、`article` 或 `[role="main"]`，缺少语义容器时回退到 `body`；整页范围从 `body` 采集。

跨内联节点词元会在公共祖先下验证连续安全区间。通过验证的节点整体移动到 `<ruby><rb>…</rb><rt>…</rt></ruby>` 中，原元素、事件监听器和样式继续生效。撤销时原节点从 `rb` 移回原位置并执行文本归一化。

## 动态网页

开启注音后，MutationObserver 会把节点增删和文本改写加入脏根队列。`pushState`、`replaceState`、`popstate` 与 `hashchange` 会触发导航维护。分析期间出现的新变化会在当前批次完成后继续增量处理。

## 远程分析与缓存

- 完整段落优先进入 Yahoo 分析，以保留多音词上下文。
- 单次请求按 UTF-8 字节限制保守分块，Yahoo `Invalid params` 会触发自适应缩块。
- 内存 LRU 保存最近 300 个结果；当前站点 `localStorage` 保存最多 200 个文本块，保留 30 天。
- 调度器执行每分钟 300 次滚动窗口；429 按 `Retry-After` 等待。
- 网络、超时与 5xx 错误最多指数退避两次。
- 单个片段最终失败会保留其他成功结果，并记录原段落偏移供菜单重试。

诊断面板显示处理进度、标注字数、API 调用、缓存命中、限流等待、瞬时重试、失败片段与最近耗时。

## 隐私模型

缓存命中的文本停留在当前页面。缓存缺失的合格正文会分段发送到 `https://jlp.yahooapis.jp/jsonrpc`，同时携带用户配置的 Client ID。

站点许可与自动标注白名单按 `location.origin` 保存。发送确认展示当前范围、首片段字符数与受限摘要；发送审计只记录本次页面会话中的真实 Yahoo 请求摘要。Client ID 保存于 ScriptCat 脚本存储，仓库、Greasy Fork 页面和 GitHub Actions 均不保存该值。

## 已知边界

- Yahoo 单次请求上限为 4KB，脚本使用约 3KB 的保守分块。
- 跨节点词元需要形成连续安全区间；混入被排除内容的区间会跳过。
- 人名、地名、作品名与自定义读音仍可能产生歧义。
- 网站框架重渲染后，脚本通过脏根队列增量恢复注音。
- 浏览器限制 `localStorage` 时，脚本继续使用内存缓存与远程分析。

## 本地开发

```bash
npm install
npm run check
```

源码按 `reading/page/scriptcat/main` 领域 Module 维护，esbuild 生成无运行时依赖的单文件安装产物。`npm run check` 会重新构建产物、执行 JavaScript 语法检查和全部 Node 回归测试。浏览器端场景位于 `work/smoke.html`。

## 自动发布

Pull Request 与 `main` push 会触发 GitHub Actions 质量门。推送与 `package.json` 版本一致的 `v*` 标签后，工作流创建 GitHub Release，并上传 `outputs/japanese-furigana.user.js`。

Greasy Fork 从 [ASCII Raw URL](https://raw.githubusercontent.com/chinnsenn/scriptcat-japanese-furigana/main/outputs/japanese-furigana.user.js) 同步代码，从 [ASCII Markdown URL](https://raw.githubusercontent.com/chinnsenn/scriptcat-japanese-furigana/main/outputs/greasyfork.md) 同步页面说明。仓库 Push Webhook 可在验证后的 `main` 更新到达时立即通知 Greasy Fork。

Webhook 一次性配置：

1. 在 [Greasy Fork Webhook 页面](https://greasyfork.org/users/webhook-info) 复制 Payload URL，并生成共享 Secret。
2. 打开 GitHub 仓库 `Settings → Webhooks → Add webhook`。
3. 填入 Payload URL，Content type 选择 `application/json`，再填入 Secret。
4. 事件选择 `Just the push event`，仅启用 Push 事件，并保持 SSL verification 与 Active 开启。
5. 在 GitHub Recent deliveries 验证 HTTP 成功响应，再到 Greasy Fork 版本页确认同步时间。

共享 Secret 只进入 GitHub Webhook 配置。

## 许可证

[MIT](LICENSE)
