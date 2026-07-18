# Japanese Furigana for Web Pages

为日语网页汉字添加上下文相关读音。脚本支持选中文本、正文区域和整页三种范围，并在 SPA、无限滚动和局部重渲染中持续维护注音。

## 使用方法

1. 通过脚本菜单打开“设置 Yahoo Client ID”，在宽型四行输入框中粘贴自己的 Yahoo! JAPAN Developer Network Client ID。长字符串会自动折行并显示字符数。
2. 打开日语网页，点击页面边缘的圆形抽象图标。
3. 首次远程分析时核对站点、范围、字符数与正文摘要，然后确认当前站点许可。
4. 注音完成后再次点击图标即可完整撤销。

Yahoo 官方接口说明：[ルビ振り API V2](https://developer.yahoo.co.jp/webapi/jlp/furigana/v2/furigana.html)

## 圆形图标状态

- 米白印章：等待标注。
- 金色环形进度：正在分析，点击可立即取消。
- 松绿色印章：标注完成，点击移除全部脚本注音。

图标内部使用“上方读音点 + 下方字形骨架”的抽象符号。按钮保持无文字呈现，并通过 `aria-label` 向辅助技术提供完整状态。

## 功能

- 三种采集范围：选中文本、正文区域、整页。
- 按元素 `lang`、页面语言、假名与上下文识别 Japanese、Other 和 Ambiguous 区间。
- 只发送 Japanese 与用户强制选择范围，并分别显示 Other/Ambiguous 跳过数。
- 自动跳过导航、页眉页脚、侧栏、表单、代码、可编辑区域、隐藏内容与已有 ruby。
- 保留网页结构、样式、事件监听器和原始元素身份。
- 跨连续内联节点词语生成一个标准 ruby。
- 支持 SPA 导航、无限滚动、文本改写和局部重渲染。
- 支持双层缓存、滚动限流、429 退避、瞬时错误重试与局部失败保留。
- 显示处理进度，并支持取消和失败片段重试。
- 按站点保存正文发送许可和自动标注白名单。
- 可清理当前站点缓存、撤销许可并查看本次真实发送摘要。
- Client ID 始终由使用者配置和管理。
- Client ID 配置框支持保存、清空和取消，并在浏览器缺少原生对话框能力时安全回退。

## 脚本菜单

- 设置 Yahoo Client ID
- 切换按钮强制显示
- 撤销当前站点正文发送许可
- 设置默认标注范围
- 重试失败片段
- 切换当前站点自动标注
- 清理当前站点读音缓存
- 查看本次实际发送范围

## 隐私

缓存缺失的 Japanese 区间或用户强制选择范围会分段发送到 `https://jlp.yahooapis.jp/jsonrpc`。Other 与 Ambiguous 区间停留在当前页面；首次发送确认展示采集范围、首片段字符数和受限摘要。真实请求审计只保留当前页面会话的有限摘要。

Client ID 存储于 ScriptCat 的脚本存储。站点许可、自动标注白名单和持久缓存均按 `location.origin` 隔离。仓库、Greasy Fork 页面与 GitHub Actions 均不保存用户的 Client ID。

## 产品边界

产品聚焦网页汉字注音。词典、翻译、学习记录、测验、账户和云同步保持在范围之外。

项目源码、完整文档与问题反馈：[GitHub Repository](https://github.com/chinnsenn/scriptcat-japanese-furigana)
