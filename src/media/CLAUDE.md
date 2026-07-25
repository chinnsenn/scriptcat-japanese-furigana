# media/
> L2 | 父级: ../CLAUDE.md

成员清单
guard.js: 视频焦点守卫 Module，按站点开关伪装可见性、捕获失焦信号、追踪动态 video，并恢复页面脚本触发的非用户暂停
CLAUDE.md: 本模块成员地图与视频行为边界

依赖关系

```text
guard.js -> browser document/window
         -> HTMLVideoElement.play()
```

开发法则

- 只处理站点级显式启用后的页面行为，默认保持零侵入。
- 用户刚操作过的暂停视为真实意图，失焦窗口内的脚本暂停才恢复。
- media Module 与 page/reading 保持隔离，组合根只负责装配。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
