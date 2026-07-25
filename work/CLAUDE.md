# work/
> L2 | 父级: ../CLAUDE.md

成员清单
japanese-furigana.test.cjs: 验证三态语言分类、跳过统计 UI、缓存、可取消 Yahoo Adapter、分块降级和读音对齐
reading-engine.test.cjs: 通过读音分析 Interface 验证缓存、可取消调度、429/瞬时退避、局部容错、进度与统计
app.test.cjs: 通过注音会话 Interface 验证 Japanese 请求过滤、Other/Ambiguous 统计、动态导航、取消、失败重试和撤销
dom.test.cjs: 通过 jsdom 验证语言证据与来源偏移、三种范围、跨内联节点标注、元素身份与完整撤销
scriptcat.test.cjs: 通过 jsdom 与 ScriptCat Adapter Interface 验证宽型 Client ID 配置框、站点许可/白名单、发送审计、范围与缓存菜单
smoke.html: 加载 outputs 构建产物并模拟 ScriptCat/Yahoo，通过 `?auto=1` 验证混排过滤、请求审计、动态正文与完整撤销
release.test.cjs: 静态验证 1.1 Userscript 元数据、GitHub CI 质量门、标签版本与 Release 产物契约
CLAUDE.md: 本模块成员地图与职责边界

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
