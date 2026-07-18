# ScriptCat 日语注音脚本 - 为日语网页生成上下文相关的汉字读音
JavaScript Userscript + ScriptCat GM API + Yahoo! JAPAN ルビ振り API

<directory>
src/ - 可维护源码，按领域算法、缓存、平台适配、界面与编排分层
scripts/ - 将模块源码打包为 ScriptCat 单文件的构建工具
outputs/ - 自动生成的可安装脚本与使用说明
work/ - 源码接口的回归测试与浏览器冒烟场景
</directory>

<config>
README.md - 公开仓库入口，说明功能、安装、开发验证与隐私边界
CONTEXT.md - 固定读音分析、页面标注、注音会话与远程授权的领域语言
.gitignore - 排除 macOS、Node 依赖与日志文件
package.json - 固定 esbuild 版本并统一 build、test、check 命令
package-lock.json - 锁定 Node 构建依赖
</config>

## 架构决策

- 远程读音引擎按完整段落分析，利用上下文消解多音词。
- DOM 层只操作文本节点，保留网页结构、事件监听器与原始文本。
- API 结果先转成稳定区间，再映射回文本节点；跨节点词元保守跳过。
- 读音结果以文本内容指纹写入页面域名的 localStorage，正文变化自然失效，过期和容量边界自动淘汰。
- 按钮只表达标注状态，运行指标集中在 hover 统计面板。
- 浮动按钮以“边缘 + 相对位置”保存布局，拖动结束统一经过吸边算法，窗口缩放时重新计算坐标。
- 所有注音使用原生 `ruby/rb/rt`，关闭时可恢复原始文本。
- 源码以 CommonJS 深模块维护，esbuild 生成无运行时依赖的单文件安装产物。

## 开发规范

- 每个源码文件保持在 800 行内，函数聚焦单一职责。
- 业务文件维护 INPUT/OUTPUT/POS 契约。
- 修改代码后运行 `npm run check`，禁止直接编辑生成产物。

## 变更日志

- 2026-07-18：建立领域语言，将读音分析与注音会话深化为独立 Module，入口收敛为组合根。
- 2026-07-18：拆分 core/cache/Yahoo/DOM/UI/main 深模块，引入可复现的 esbuild 单文件构建流。
- 2026-07-18：补齐公开 GitHub 仓库入口与忽略规则，准备迁移至独立仓库。
- 2026-07-18：0.2.1 缩小按钮并增加拖动吸边、位置持久化与视口自适应。
- 2026-07-18：0.2.0 增加 localStorage 内容缓存、双状态按钮与 hover 统计面板。
- 2026-07-17：0.1.4 在按钮显示 Yahoo API 本页滚动 60 秒估算额度。
- 2026-07-17：0.1.3 将 Yahoo 响应缓存改为固定容量 LRU，限制长期页面会话的内存占用。
- 2026-07-17：0.1.2 为 Yahoo `Invalid params` 增加自适应分块重试与局部跳过。
- 2026-07-17：0.1.1 改用官方 `appid` 参数传递 Client ID，并保留 Yahoo HTTP 错误正文。
- 2026-07-17：建立首版 Yahoo API 注音引擎、页面识别、DOM 标注与测试。
