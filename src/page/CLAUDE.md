# page/
> L2 | 父级: ../CLAUDE.md

成员清单
dom.js: 页面标注 Adapter，以 collect/apply/remove/isJapanesePage 隐藏可见文本采集、区间映射和 ruby 恢复
ui.js: 浮动界面 Module，封装双状态渲染、统计面板、拖拽吸边和位置持久化
app.js: 注音会话深 Module，以 start/toggle 隐藏状态流、页面标注、动态正文观察和失败恢复
CLAUDE.md: 本模块成员地图与注音会话依赖

依赖关系

```text
app.js -> 注入的 reading/page/ui/scriptcat Interface
dom.js -> ../text.js
ui.js  -> browser document/window
```

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
