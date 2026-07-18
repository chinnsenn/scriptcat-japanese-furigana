# ScriptCat 日语网页汉字注音

为日语网页中的汉字添加上下文相关读音的 ScriptCat 用户脚本。脚本使用 Yahoo! JAPAN ルビ振り API 分析正文，并通过标准 `<ruby>` 元素写回页面。

## 功能

- 自动识别日语页面，提供“标注读音 / 已完成标注”双状态按钮。
- 支持鼠标和触摸拖动，松手后自动吸附最近屏幕边缘。
- 优先读取内存与 `localStorage` 缓存，正文变化或缓存缺失时才调用 API。
- 对 Yahoo `Invalid params` 自动缩小文本块重试，局部异常不会终止整页。
- Hover 面板展示标注字数、API 调用、缓存命中、耗时与异常片段。
- 支持撤销注音、SPA 动态内容与窗口尺寸变化。

## 安装

1. 在 ScriptCat 中新建普通用户脚本。
2. 复制 [outputs/japanese-furigana.user.js](outputs/japanese-furigana.user.js) 的全部内容并保存。
3. 打开日语网页，通过脚本菜单配置 Yahoo! JAPAN Developer Network Client ID。
4. 点击页面右下角的“标注读音”。

详细配置、隐私说明与已知边界见 [使用说明](outputs/README.md)。

## 开发与验证

```bash
node --check outputs/japanese-furigana.user.js
node --test work/japanese-furigana.test.cjs
```

纯逻辑测试覆盖 UTF-8 分块、读音区间映射、API 降级、滚动额度、持久缓存和按钮吸边算法。`work/smoke.html` 提供浏览器端冒烟场景。

## 隐私

缓存命中的文本保留在当前网站域名的 `localStorage`。缓存缺失的可见正文会分段发送到 Yahoo! JAPAN ルビ振り API；脚本会跳过输入框、代码块、可编辑区域、隐藏区域和已有注音。

