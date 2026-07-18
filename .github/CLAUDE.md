# .github/
> L2 | 父级: ../CLAUDE.md

成员清单
workflows/: GitHub Actions 自动验证与标签发布工作流

依赖关系

```text
workflows/release.yml -> package-lock.json -> npm run check
                      -> outputs/japanese-furigana.user.js
                      -> GitHub Release
GitHub Push Webhook   -> Greasy Fork 外部同步
```

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

