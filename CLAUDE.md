# ScriptCat 日语注音脚本 - 为日语网页生成上下文相关的汉字读音
JavaScript Userscript + ScriptCat GM API + Yahoo! JAPAN ルビ振り API

<directory>
outputs/ - 用户可直接安装的脚本与使用说明
work/ - 核心逻辑的本地测试
</directory>

<config>
README.md - 公开仓库入口，说明功能、安装、开发验证与隐私边界
.gitignore - 排除 macOS、Node 依赖与日志文件
outputs/japanese-furigana.user.js - 可直接导入 ScriptCat 的单文件用户脚本
outputs/README.md - 安装、配置、隐私与限制说明
</config>

## 架构决策

- 远程读音引擎按完整段落分析，利用上下文消解多音词。
- DOM 层只操作文本节点，保留网页结构、事件监听器与原始文本。
- API 结果先转成稳定区间，再映射回文本节点；跨节点词元保守跳过。
- 读音结果以文本内容指纹写入页面域名的 localStorage，正文变化自然失效，过期和容量边界自动淘汰。
- 按钮只表达标注状态，运行指标集中在 hover 统计面板。
- 浮动按钮以“边缘 + 相对位置”保存布局，拖动结束统一经过吸边算法，窗口缩放时重新计算坐标。
- 所有注音使用原生 `ruby/rb/rt`，关闭时可恢复原始文本。

## 开发规范

- 单文件保持在 800 行内，函数聚焦单一职责。
- 业务文件维护 INPUT/OUTPUT/POS 契约。
- 修改代码后运行 `node --check` 与 `node --test`。

## 变更日志

- 2026-07-18：补齐公开 GitHub 仓库入口与忽略规则，准备迁移至独立仓库。
- 2026-07-18：0.2.1 缩小按钮并增加拖动吸边、位置持久化与视口自适应。
- 2026-07-18：0.2.0 增加 localStorage 内容缓存、双状态按钮与 hover 统计面板。
- 2026-07-17：0.1.4 在按钮显示 Yahoo API 本页滚动 60 秒估算额度。
- 2026-07-17：0.1.3 将 Yahoo 响应缓存改为固定容量 LRU，限制长期页面会话的内存占用。
- 2026-07-17：0.1.2 为 Yahoo `Invalid params` 增加自适应分块重试与局部跳过。
- 2026-07-17：0.1.1 改用官方 `appid` 参数传递 Client ID，并保留 Yahoo HTTP 错误正文。
- 2026-07-17：建立首版 Yahoo API 注音引擎、页面识别、DOM 标注与测试。
