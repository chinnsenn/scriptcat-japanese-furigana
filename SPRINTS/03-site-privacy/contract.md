# Sprint 03：站点隐私控制

## Goal

用户可以按站点决定正文发送与自动标注，并从脚本菜单检查和清理所有本地隐私状态。

## Acceptance Criteria

- [ ] 正文发送许可与自动标注白名单均按 origin 隔离；白名单站点加载后自动进入默认范围注音会话。
- [ ] 首次发送确认明确展示当前采集范围、首个未缓存片段的字符数与文本摘要。
- [ ] “查看本次实际发送范围”菜单只展示真正进入 GM 远程请求的范围、请求数、字符数和受限摘要。
- [ ] 菜单可撤销当前站点许可、清理当前站点读音缓存、设置默认范围和管理用户自己的 Client ID。
- [ ] 清理缓存同时清除当前引擎内存缓存与当前 origin 的 localStorage 缓存。
- [ ] `npm run check` 与授权隔离、白名单、发送审计、缓存清理回归全部通过。

## Files Expected

- `src/scriptcat.js`
- `src/page/app.js`
- `src/reading/cache.js`
- `src/reading/engine.js`
- `src/reading/yahoo.js`
- `src/main.js`
- `work/scriptcat.test.cjs`
- `work/reading-engine.test.cjs`
- `work/app.test.cjs`
- `README.md`

