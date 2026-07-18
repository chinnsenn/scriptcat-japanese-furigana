# src/
> L2 | 父级: ../CLAUDE.md

成员清单
reading/: 读音分析 Module，封装缓存、请求调度、Yahoo Adapter、分块降级、对齐和分析统计
page/: 页面标注与注音会话 Module，封装 DOM、浮动界面、生命周期和脏根增量正文
text.js: 共享纯文本算法，负责语言识别、汉字判断与 UTF-8 安全分块
scriptcat.js: ScriptCat Adapter，封装 GM 存储、默认范围、站点许可/自动白名单、发送审计、配置菜单和错误反馈
main.js: 浏览器组合根，只构造 Adapter、连接 Module Interface 并启动注音会话
CLAUDE.md: 本模块成员地图与依赖边界

依赖关系

```text
main.js -> reading/engine.js -> reading/core.js -> text.js
        |                  -> reading/cache.js -> text.js
        |                  -> reading/scheduler.js
        -> reading/yahoo.js -> reading/core.js
        -> page/app.js
        -> page/dom.js -> text.js
        -> page/ui.js
        -> scriptcat.js
```

开发法则

- `text.js` 与 `reading/core.js` 保持无浏览器状态，可直接由 Node 测试。
- 适配器隐藏平台细节，`main.js` 只消费稳定接口。
- 依赖保持单向，兄弟模块之间不共享可变状态。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
