# reading/
> L2 | 父级: ../CLAUDE.md

成员清单
core.js: 读音分析纯算法，负责 Yahoo 请求描述、词结果对齐和 Invalid params 递归降级
cache.js: 缓存实现，封装内存 LRU、滚动额度与页面 localStorage 持久缓存
yahoo.js: Yahoo Adapter，封装跨域请求、HTTP/JSON-RPC 错误和响应解析
engine.js: 读音分析深 Module，以 analyze(texts) 隐藏分块、缓存、远程授权、并发、额度和统计
CLAUDE.md: 本模块成员地图与读音分析依赖

依赖关系

```text
engine.js -> core.js -> ../text.js
          -> cache.js -> ../text.js
yahoo.js  -> core.js
```

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
