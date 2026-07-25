# src/
> L2 | 父级: ../CLAUDE.md

成员清单
reading/: 读音分析 Module，封装缓存、请求调度、Yahoo Adapter、分块降级、对齐和分析统计
page/: 页面标注与注音会话 Module，封装语言区间、DOM、浮动界面、生命周期和脏根增量正文
media/: 视频行为 Module，封装站点级防暂停、可见性伪装、失焦信号捕获和动态 video 追踪
text.js: 共享纯文本算法，负责 Japanese/Other/Ambiguous 三态分类、汉字判断与 UTF-8 安全分块
scriptcat.js: ScriptCat Adapter，封装宽型 Client ID 配置框、GM 存储、默认范围、站点许可/自动白名单、视频防暂停开关、发送审计、配置菜单和错误反馈
main.js: 浏览器组合根，早期安装视频守卫，DOM 就绪后构造 Adapter、连接 Module Interface 并启动注音会话
CLAUDE.md: 本模块成员地图与依赖边界

依赖关系

```text
main.js -> media/guard.js
        -> reading/engine.js -> reading/core.js -> text.js
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
- `page/dom.js` 保留每个语言区间的 DOM 来源、分类证据与块内偏移；`page/app.js` 只把 Japanese 区间交给 reading。
- `media/guard.js` 只处理已启用站点的视频行为，禁止把视频状态写入注音会话。
- 适配器隐藏平台细节，`main.js` 只消费稳定接口。
- 依赖保持单向，兄弟模块之间不共享可变状态。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
