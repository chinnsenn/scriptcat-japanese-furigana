# Sprint 01：精准采集与安全标注

## Goal

用户可以选择标注范围，并让跨内联节点的词语在不破坏页面结构与事件的前提下获得可完整撤销的读音。

## Acceptance Criteria

- [ ] 用户选择“选中文本”时只发送并标注当前选择；选择“正文区域”时限定正文容器；选择“整页”时覆盖全部合格可见文本。
- [ ] 导航、页眉页脚、侧栏、表单、代码、隐藏内容、可编辑内容与任意已有 `ruby` 均不会进入读音分析。
- [ ] `東<strong>京</strong>` 这类跨内联节点词语可以获得连续读音展示，原有元素、属性与事件监听器保持有效。
- [ ] 点击完成状态后，脚本创建的节点全部消失，原始文本与原有 DOM 身份完整恢复。
- [ ] `npm run check` 与浏览器 DOM 回归测试全部通过。

## Files Expected

- `src/page/dom.js`
- `src/page/app.js`
- `src/scriptcat.js`
- `src/main.js`
- `work/dom.test.cjs`
- `work/app.test.cjs`
- `work/scriptcat.test.cjs`
- `README.md`

