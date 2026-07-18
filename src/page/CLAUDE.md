# page/
> L2 | 父级: ../CLAUDE.md

成员清单
dom.js: 页面标注 Adapter，以三范围 collect/跨节点 apply/remove/isJapanesePage 隐藏范围解析、区间映射和节点身份恢复
ui.js: 浮动界面 Module，封装纯图标圆形状态、环形进度/取消、韧性统计面板、拖拽吸边和位置持久化
app.js: 注音会话深 Module，以 start/toggle/retryFailures 隐藏范围、导航脏根、进度取消、局部成功和失败重试
CLAUDE.md: 本模块成员地图与注音会话依赖

依赖关系

```text
app.js -> 注入的 reading/page/ui/scriptcat Interface
dom.js -> ../text.js
ui.js  -> browser document/window
```

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
