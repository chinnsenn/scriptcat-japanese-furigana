# Sprint 02：持续会话与稳定分析

## Goal

注音会话持续覆盖动态网页，并让用户在可见进度下取消处理、保留局部成功结果和重试失败片段。

## Acceptance Criteria

- [ ] SPA 的 `pushState`、`replaceState`、前进后退，连同无限滚动、文本改写与局部重渲染，都把受影响正文加入当前注音会话。
- [ ] 圆形处理图标实时显示环形进度，无障碍名称包含 `completed/total`；处理期间点击会立即取消等待或远程请求。
- [ ] 网络、超时及 5xx 瞬时错误最多指数退避重试两次；429 继续遵守 `Retry-After` 与统一额度调度。
- [ ] 单个远程片段最终失败时，其余片段仍完成标注；失败片段可通过脚本菜单单独重试。
- [ ] 统计面板展示处理进度、限流等待、瞬时重试、失败片段与耗时。
- [ ] `npm run check` 与新增取消、局部容错、失败重试、SPA 导航回归全部通过。

## Files Expected

- `src/page/app.js`
- `src/page/ui.js`
- `src/reading/scheduler.js`
- `src/reading/engine.js`
- `src/reading/yahoo.js`
- `src/scriptcat.js`
- `work/app.test.cjs`
- `work/reading-engine.test.cjs`
- `work/japanese-furigana.test.cjs`
- `work/smoke.html`
