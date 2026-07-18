# reading/
> L2 | 父级: ../CLAUDE.md

成员清单
core.js: 读音分析纯算法，负责 Yahoo 请求描述、词结果对齐和 Invalid params 递归降级
cache.js: 缓存实现，封装可清理的内存 LRU 与当前站点 localStorage 持久缓存
scheduler.js: 请求调度 Module，串行分配滚动窗口额度，执行可取消等待并统计退避时间
yahoo.js: Yahoo Adapter，封装可取消跨域请求、HTTP/JSON-RPC 错误、瞬时标记、Retry-After 和响应解析
engine.js: 读音分析深 Module，以 analyze(texts, options) 隐藏分块、缓存、进度取消、局部容错、瞬时重试和统计
CLAUDE.md: 本模块成员地图与读音分析依赖

依赖关系

```text
engine.js -> core.js -> ../text.js
          -> cache.js -> ../text.js
          -> scheduler.js
yahoo.js  -> core.js
```

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
