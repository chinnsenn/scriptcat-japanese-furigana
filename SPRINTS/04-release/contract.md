# Sprint 04：自动发布与 1.0 验收

## Goal

1.0 构建产物通过 GitHub 标签形成可下载 Release，并由 Greasy Fork 的 GitHub Push Webhook 自动同步。

## Acceptance Criteria

- [ ] 包版本与 Userscript 元数据升级到 1.0.0，主页、问题反馈和直接更新地址指向正式 GitHub 仓库。
- [ ] Pull Request 与 main push 自动执行 `npm ci`、全量检查和生成产物一致性校验。
- [ ] `v*` 标签只在标签与 package 版本一致时创建 GitHub Release，并附加可安装 `.user.js` 产物。
- [ ] README 记录 Greasy Fork 导入 Raw URL、GitHub Webhook Payload URL/Secret、JSON 内容类型和仅 Push 事件的一次性配置。
- [ ] GitHub Webhook 的真实交付状态与 Greasy Fork 同步状态获得外部证据；缺少账户凭据时明确保留为外部待办。
- [ ] 1.0 产品目标逐项审计，`npm run check`、Chrome 冒烟和工作流静态校验全部通过。

## Files Expected

- `.github/workflows/release.yml`
- `.github/CLAUDE.md`
- `.github/workflows/CLAUDE.md`
- `package.json`
- `package-lock.json`
- `scripts/build.cjs`
- `README.md`
- `outputs/README.md`
- `outputs/japanese-furigana.user.js`

