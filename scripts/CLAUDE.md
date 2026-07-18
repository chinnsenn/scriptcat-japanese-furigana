# scripts/
> L2 | 父级: ../CLAUDE.md

成员清单
build.cjs: 使用 esbuild 将 src/main.js 的三态语言过滤与注音会话打包为单文件，并注入用户脚本元数据与 L3 契约
CLAUDE.md: 本模块成员地图与构建边界

依赖关系

```text
build.cjs -> package.json
          -> src/main.js
          -> outputs/japanese-furigana.user.js
```

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
