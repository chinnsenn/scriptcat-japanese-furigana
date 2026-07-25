# outputs/
> L2 | 父级: ../CLAUDE.md

成员清单
japanese-furigana.user.js: 由 scripts/build.cjs 生成的含三态语言区间过滤的 ScriptCat 单文件安装产物
README.md: 面向使用者的语言过滤、安装、Client ID 配置、隐私与已知边界说明
greasyfork.md: 通过 ASCII Raw URL 同步到 Greasy Fork 的语言过滤与产品说明
CLAUDE.md: 本模块成员地图与职责边界

依赖关系

```text
src/main.js -> scripts/build.cjs -> japanese-furigana.user.js
japanese-furigana.user.js        -> ScriptCat GM API -> Yahoo! JAPAN ルビ振り API
README.md                         -> japanese-furigana.user.js
greasyfork.md                    -> Greasy Fork 脚本页面
```

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
