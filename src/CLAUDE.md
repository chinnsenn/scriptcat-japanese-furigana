# src/
> L2 | 父级: ../CLAUDE.md

成员清单
core.js: 纯领域算法，负责日语识别、UTF-8 分块、Yahoo 结果对齐与 DOM 区间映射
cache.js: 缓存模块，封装内存 LRU、滚动额度与页面 localStorage 持久缓存
yahoo.js: Yahoo 适配器，封装 ScriptCat 跨域请求、HTTP/JSON-RPC 错误和响应解析
dom.js: DOM 适配器，封装可见文本采集、ruby 写入、撤销和页面语言判断
ui.js: 浮动界面模块，封装双状态渲染、统计面板、拖拽吸边和位置持久化
main.js: 浏览器入口与控制器，编排配置、缓存优先分析、并发、动态页面观察和错误反馈
CLAUDE.md: 本模块成员地图与依赖边界

依赖关系

```text
main.js -> core.js
        -> cache.js -> core.js
        -> yahoo.js -> core.js
        -> dom.js -> core.js
        -> ui.js
```

开发法则

- `core.js` 保持无浏览器状态，可直接由 Node 测试。
- 适配器隐藏平台细节，`main.js` 只消费稳定接口。
- 依赖保持单向，兄弟模块之间不共享可变状态。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
