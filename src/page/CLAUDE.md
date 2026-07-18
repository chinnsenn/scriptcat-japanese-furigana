# page/
> L2 | 父级: ../CLAUDE.md

成员清单
dom.js: 页面标注 Adapter，以三态语言 collect/跨节点 apply/remove/isJapanesePage 隐藏证据继承、来源偏移、区间映射和节点身份恢复
ui.js: 浮动界面 Module，封装纯图标圆形状态、环形进度/取消、Other/Ambiguous 跳过统计、拖拽吸边和位置持久化
app.js: 注音会话深 Module，以 start/toggle/retryFailures 隐藏 Japanese 请求过滤、语言统计、导航脏根、进度取消和失败重试
CLAUDE.md: 本模块成员地图与注音会话依赖

依赖关系

```text
app.js -> ../text.js + 注入的 reading/page/ui/scriptcat Interface
dom.js -> ../text.js 三态语言分类
ui.js  -> browser document/window
```

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
