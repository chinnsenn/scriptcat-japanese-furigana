# work/
> L2 | 父级: ../CLAUDE.md

成员清单
japanese-furigana.test.cjs: 验证共享纯算法、缓存、Yahoo Adapter、分块降级、读音对齐和按钮吸边
reading-engine.test.cjs: 通过读音分析 Interface 验证懒授权、两级缓存、分块并发、顺序与统计
app.test.cjs: 通过注音会话 Interface 验证标注、增量处理、撤销和按钮显隐状态机
scriptcat.test.cjs: 通过 ScriptCat Adapter Interface 验证 Client ID、远程授权和隐私确认持久化
smoke.html: 加载 outputs 构建产物并模拟 ScriptCat/Yahoo，通过 `?auto=1` 自动验证首次标注、动态正文与完整撤销
CLAUDE.md: 本模块成员地图与职责边界

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
