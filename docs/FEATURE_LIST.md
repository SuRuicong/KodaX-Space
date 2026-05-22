# KodaX Space Feature List

> Last Updated: 2026-05-22 (v0.1.1 TUI 对齐 batch 完成 + v0.1.6 持久化 + 0.7.42 升级)
>
> **2026-05-18 form-factor reset**：alpha.0 的 UI 形态偏 IDE，alpha.1 按 [ADR-004](ADR/ADR-004-panel-model.md) 重构对齐 Claude Desktop 中的 Claude Code。F006/F008/F009 标记重做（main 端保留）；新增 F011-revised / F012-revised。详见下面 "v0.1.0-alpha.1 重构 plan" 区段。
>
> **2026-05-18 priority reorder**：用户指令"先把 KodaX 已有的能力在 desktop 中接通，再开发 KodaX 不具备的功能"。v0.1.1 以"暴露 KodaX 已具备的能力"为主线（MCP/Subagent/Repointel/Skills/Session lineage），原 v0.1.2 的 KodaX 生态项前移；终端、富预览等"desktop 增量"后移到 v0.1.3+。
>
> **2026-05-18 TUI alignment lockdown**（[ADR-005](ADR/ADR-005-permission-mode-canonical.md)）：read KodaX REPL 源码后发现 desktop mode 自创 4 档与 TUI canonical 3 档（plan/accept-edits/auto + engine 子档）完全错位。**FEATURE_029 alpha.1 内完成 schema breaking 重写**（无外部用户，零代价）；**FEATURE_030~037 v0.1.1 内完成 8 个 TUI 对齐 features**（AutoModeGuardrail / slash command / askUser modal / sessions tree fork rewind / AGENTS.md / skills / MCP UI / subagent tree）。完成后 desktop 与 TUI 用户面行为达到 90% 一致。
> Source of truth: [PRD](PRD.md) · [HLD](HLD.md) · [ADR/](ADR/)
> Versions: v0.1.0 → v0.1.5（M0–M1，约 3–4 个月）

## Index

| ID | Title | Category | Priority | Version | Status | Design |
|----|-------|----------|----------|---------|--------|--------|
| 001 | Electron 工程骨架 | New | Critical | v0.1.0 | Completed | [v0.1.0.md#001](features/v0.1.0.md#feature_001-electron-工程骨架) |
| 002 | IPC schema (zod) | New | Critical | v0.1.0 | Completed | [v0.1.0.md#002](features/v0.1.0.md#feature_002-ipc-schema-zod) |
| 003 | Main 进程 KodaX runtime 集成 | New | Critical | v0.1.0 | Completed | [v0.1.0.md#003](features/v0.1.0.md#feature_003-main-进程-kodax-runtime-集成) |
| 003R | Real KodaX adapter（@kodax-ai/kodax@0.7.40） | New | Critical | v0.1.0-alpha.1 | Completed | 见下方 alpha.1 重构 plan |
| 004 | Provider 配置 GUI + Keychain | New | Critical | v0.1.0 | Completed | [v0.1.0.md#004](features/v0.1.0.md#feature_004-provider-配置-gui--keychain) |
| 005 | 项目与 Session 管理 UI | New | Critical | v0.1.0 | Completed | [v0.1.0.md#005](features/v0.1.0.md#feature_005-项目与-session-管理-ui) |
| 006 | 对话流 UI + tool call 渲染 | New | Critical | v0.1.0 | Completed | [v0.1.0.md#006](features/v0.1.0.md#feature_006-对话流-ui--tool-call-渲染) |
| 007 | Permission 弹窗组件 | New | Critical | v0.1.0 | Completed | [v0.1.0.md#007](features/v0.1.0.md#feature_007-permission-弹窗组件) |
| 008 | Work 进度 + reasoning mode 切换 | New | High | v0.1.0 | Completed | [v0.1.0.md#008](features/v0.1.0.md#feature_008-work-进度--reasoning-mode-切换) |
| 009 | 文件面板（Monaco read-only + diff） | New | High | v0.1.0 | Completed | [v0.1.0.md#009](features/v0.1.0.md#feature_009-文件面板monaco-read-only--diff) |
| 010 | 跨平台安装包（unsigned dev） | New | Critical | v0.1.0 | Completed | [v0.1.0.md#010](features/v0.1.0.md#feature_010-跨平台安装包unsigned-dev) |
| 011 | 内置终端（xterm.js + node-pty 单 tab） | New | High | v0.1.1 | Planned | [v0.1.1.md#011](features/v0.1.1.md#feature_011-内置终端xtermjs--node-pty-单-tab) |
| 012 | Subagent tree 视图 | New | High | v0.1.1 | Planned | [v0.1.1.md#012](features/v0.1.1.md#feature_012-subagent-tree-视图) |
| 013 | MCP 管理 v1（列表 + 启停） | New | High | v0.1.1 | Planned | [v0.1.1.md#013](features/v0.1.1.md#feature_013-mcp-管理-v1列表--启停) |
| 014 | NAPI native-tokenizer | Refactor | High | v0.1.1 | Planned | [v0.1.1.md#014](features/v0.1.1.md#feature_014-napi-native-tokenizer) |
| 015 | Repointel 状态条 + warm | New | High | v0.1.2 | Planned | [v0.1.2.md#015](features/v0.1.2.md#feature_015-repointel-状态条--warm) |
| 016 | Session lineage 图 | New | High | v0.1.2 | Planned | [v0.1.2.md#016](features/v0.1.2.md#feature_016-session-lineage-图) |
| 017 | CLI ↔ Space 文件级 teleport | New | High | v0.1.2 | Planned | [v0.1.2.md#017](features/v0.1.2.md#feature_017-cli--space-文件级-teleport) |
| 018 | Quick Ask popover | New | High | v0.1.2 | Planned | [v0.1.2.md#018](features/v0.1.2.md#feature_018-quick-ask-popover) |
| 019 | 主题（明/暗/系统跟随） | Enhancement | Medium | v0.1.3 | Planned | [v0.1.3.md#019](features/v0.1.3.md#feature_019-主题明暗系统跟随) |
| 020 | 桌面通知 | Enhancement | Medium | v0.1.3 | Planned | [v0.1.3.md#020](features/v0.1.3.md#feature_020-桌面通知) |
| 021 | `.mcpb` 一键安装 | New | Medium | v0.1.3 | Planned | [v0.1.3.md#021](features/v0.1.3.md#feature_021-mcpb-一键安装) |
| 022 | 自动更新（Squirrel） | New | Medium | v0.1.3 | Planned | [v0.1.3.md#022](features/v0.1.3.md#feature_022-自动更新squirrel) |
| 023 | 内置终端多 tab | Enhancement | Medium | v0.1.4 | Planned | [v0.1.4.md#023](features/v0.1.4.md#feature_023-内置终端多-tab) |
| 024 | 文件富预览（PDF / docx / xlsx） | Enhancement | Medium | v0.1.4 | Planned | [v0.1.4.md#024](features/v0.1.4.md#feature_024-文件富预览pdf--docx--xlsx) |
| 025 | NAPI native-diff | Refactor | Medium | v0.1.4 | Planned | [v0.1.4.md#025](features/v0.1.4.md#feature_025-napi-native-diff) |
| 026 | NAPI native-fuzzy | New | Medium | v0.1.4 | Planned | [v0.1.4.md#026](features/v0.1.4.md#feature_026-napi-native-fuzzy) |
| 027 | 代码签名 + notarize | Internal | Medium | v0.1.5 | Planned | [v0.1.5.md#027](features/v0.1.5.md#feature_027-代码签名--notarize) |
| 028 | 隐私政策 + 文档站 | Internal | Low | v0.1.5 | Planned | [v0.1.5.md#028](features/v0.1.5.md#feature_028-隐私政策--文档站) |
| 029 | Permission Mode canonical 3 + Auto engine 子档 | Refactor | Critical | v0.1.0-alpha.1 | Completed | [v0.1.0.md#029](features/v0.1.0.md#feature_029-permission-mode-canonical-3--auto-engine-子档) |
| 030 | AutoModeToolGuardrail bootstrap | New | Critical | v0.1.1 | Completed | [v0.1.1.md#030](features/v0.1.1.md#feature_030-automodetoolguardrail-bootstrap) |
| 031 | Slash command runtime + 第一批命令 | New | Critical | v0.1.1 | Completed | [v0.1.1.md#031](features/v0.1.1.md#feature_031-slash-command-runtime--第一批命令) |
| 032 | askUser modal + IPC | New | Critical | v0.1.1 | Completed | [v0.1.1.md#032](features/v0.1.1.md#feature_032-askuser-modal--ipc) |
| 033 | Sessions tree + fork + rewind (in-memory) | New | High | v0.1.1 | Completed | [v0.1.1.md#033](features/v0.1.1.md#feature_033-sessions-tree--fork--rewind) |
| 034 | AGENTS.md auto-load + 显示 | New | High | v0.1.1 | Completed | [v0.1.1.md#034](features/v0.1.1.md#feature_034-agentsmd-auto-load--显示) |
| 035 | Skills 发现 + 执行 | New | High | v0.1.1 | Completed | [v0.1.1.md#035](features/v0.1.1.md#feature_035-skills-发现--执行) |
| 036 | MCP 管理 UI (read-only listing；F039 出 SDK manager 后升级) | New | High | v0.1.1 | Completed | [v0.1.1.md#036](features/v0.1.1.md#feature_036-mcp-管理-ui-替换原-feature_013-计划) |
| 037 | Subagent tree 视图 | New | High | v0.1.1 | Completed | [v0.1.1.md#037](features/v0.1.1.md#feature_037-subagent-tree-视图-refine-原-feature_012) |
| 038 | F033 Sessions 持久化升级（SDK ≥ 0.7.42） | Refactor | High | v0.1.6 | Completed | [v0.1.6.md#038](features/v0.1.6.md#feature_038-f033-sessions-持久化升级接-kodax-sdk--0742) |
| 039 | F036 MCP 管理完整版（start/stop/log/tool catalog；接 KodaX SDK MCP manager） | Refactor | High | v0.1.7 | Planned | [v0.1.7.md#039](features/v0.1.7.md#feature_039-f036-mcp-管理完整版) |

## v0.1.0-alpha.1 重构 plan（2026-05-18）

**起因**：alpha.0 的 UI 形态偏 VS Code（常驻文件树/右抽屉 Monaco/顶部 TopBar），跟 [ADR-004](ADR/ADR-004-panel-model.md) 的 Coder 面板 + Claude Desktop 对标定位脱节。alpha.1 重构 UI shell。

**main 端零改动**：IPC schema / KodaX runtime / Permission broker / Provider config / files handler 全部复用，**只重写 renderer**。

**重做的 feature**：

| ID | 原状 | alpha.1 调整 |
|----|-----|-------------|
| F006 | 对话流 + 1 tool = 1 卡 | tool 聚合 "Ran N commands ›" 折叠 |
| F008 | 常驻 TopBar (provider/work/harness/reasoning) | 拆掉常驻栏；provider+Effort 进底部 selector；Work/harness 进 Tasks popout |
| F009 | 右抽屉 FilePanel + FileTree + Monaco 常驻 | 砍 FileTree + 抽屉；Monaco 改 Preview/Diff popout 按需呼出 |

**新增（alpha.1）**：

| ID | 标题 | 范围 | 状态 |
|----|------|------|------|
| F011-revised | Coder shell layout (Claude Desktop 对标) | sidebar mode tab + 顶部面包屑 + 右上 5 popout toolbar + 底部 chip bar + model+Effort selector | ✅ 1c4dc73 |
| F011-P0/P1 | Mode selector + Context window + Session menu + Attach menu + tool 聚合 | 4 modes + Ctrl+M + 1M cap + 8-item dropdown + + popup + "Ran N commands ›" | ✅ a981955 / 05b1646 |
| F012-revised | Tasks / Plan popout | 右上 Tasks popout 装 Work 预算 + harness profile；Plan popout 装多步任务 | ⚠️ skeleton 已搭，事件待 KodaX SDK 暴露 |
| F003R | Real KodaX adapter | `npm i @kodax-ai/kodax@0.7.40` + `RealKodaXSession` 实接 `runKodaX`；8 个 KodaXEvents 映射到 SessionEvent push；session 落 `~/.kodax/sessions/` 跟 CLI 共享；provider key 走用户 env vars | ✅ 11469f2 |

**原 F011 / F012 (v0.1.1)**：内置终端单 tab / Subagent tree → 这些设计要按新形态重写，留 v0.1.1 重新打包成"Terminal popout"和"Subagent panel in Tasks"。

---

### 2026-05-18 alpha.1 reorder：v0.1.1 主线"暴露 KodaX 已具备的能力"

用户指令"先把 KodaX 已有的能力在 desktop 中接通"，v0.1.1 重排为：

| 优先级 | Feature | 性质 | 说明 |
|--------|---------|------|------|
| P0 | F013 MCP 管理 v1 | 暴露 KodaX 已有 | KodaX SDK 已有 mcp config 解析与启停 |
| P0 | F012 Subagent tree | 暴露 KodaX 已有 | KodaX runtime 已 emit subagent 事件，desktop 接 UI |
| P0 | F015 Repointel 状态条 | 暴露 KodaX 已有 | KodaX 已有 Repointel pool，desktop 加 status bar |
| P1 | F016 Session lineage 图 | 暴露 KodaX 已有 | `~/.kodax/sessions/` 已存 parent/child 关系 |
| P1 | (新) Skills/Slash commands 展示 | 暴露 KodaX 已有 | KodaX 已有 skill registry，接 attach 菜单 / `/` 自动补全 |
| P2 | F011 内置终端 (popout) | desktop 新增 | 后移 — 非 KodaX 已有 |
| P2 | F014 NAPI tokenizer | 性能优化 | 后移 |

---

## Status

```
=== FEATURE LIST ===
Last Updated: 2026-05-22

--- PLANNED (15) ---

v0.1.0 (alpha foundation): ✅ 10/10 完成 — alpha 可发布
v0.1.0-alpha.1 + v0.1.1:   ✅ 10/10 TUI 对齐 batch 完成 (F029-F037 + F003R)
v0.1.1 originals:           3 features (F011 terminal, F012 subagent tree (refined via F037), F014 napi)
v0.1.2 (生态打通):          4 features (F015-F018)
v0.1.3 (UX polish):         4 features (F019-F022)
v0.1.4 (release-ready):     4 features (F023-F026)
v0.1.5 (release polish):    2 features (F027-F028)
v0.1.6 (持久化):           ✅ 1/1 完成 (F038)
v0.1.7 (MCP 完整版):        1 feature (F039 — 等 SDK MCP manager)

--- IN PROGRESS (0) ---

--- COMPLETED (21) ---

[NEW, CRITICAL] 001: Electron 工程骨架 (COMPLETED 2026-05-16)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
[NEW, CRITICAL] 002: IPC schema (zod) (COMPLETED 2026-05-16)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
[NEW, CRITICAL] 003: Main 进程 KodaX runtime 集成 (COMPLETED 2026-05-16)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
  Note: shipped Mock adapter; Real adapter chore 已在 alpha.1 完成（F003R / 11469f2）
[NEW, CRITICAL] 003R: Real KodaX adapter (COMPLETED 2026-05-18)
  Planned: v0.1.0-alpha.1 → Released: v0.1.0-alpha.1
  Note: @kodax-ai/kodax@0.7.40 + RealKodaXSession；KodaXEvents → SessionEvent；
  默认走 Real（mock provider 或 KODAX_FORCE_MOCK=1 才走 Mock）
[NEW, CRITICAL] 004: Provider 配置 GUI + Keychain (COMPLETED 2026-05-17)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
  Note: keytar 为 optionalDependency；未装时 fallback 到 in-memory store
[NEW, CRITICAL] 005: 项目与 Session 管理 UI (COMPLETED 2026-05-16)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
[NEW, CRITICAL] 006: 对话流 UI + tool call 渲染 (COMPLETED 2026-05-17)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
[NEW, CRITICAL] 007: Permission 弹窗组件 (COMPLETED 2026-05-17)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
[NEW, HIGH] 008: Work 进度 + reasoning mode 切换 (COMPLETED 2026-05-17)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
[NEW, HIGH] 009: 文件面板（Monaco read-only + diff） (COMPLETED 2026-05-17)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
  Note: Monaco bundled (no CDN); editor.worker only (no language services); 5MB read cap + path-traversal defense
[NEW, CRITICAL] 010: 跨平台安装包（unsigned dev） (COMPLETED 2026-05-17)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
  Note: Win NSIS x64 (79 MB) + macOS DMG universal; release workflow on tag v*; smoke-pack 校验 asar 内容 / size cap

[REFACTOR, CRITICAL] 029: Permission Mode canonical 3 + Auto engine 子档 (COMPLETED 2026-05-19)
  Note: ADR-005 canonical 3 mode (plan/accept-edits/auto + llm|rules 子档)
[NEW, CRITICAL] 030: AutoModeToolGuardrail bootstrap (COMPLETED 2026-05-19)
[NEW, CRITICAL] 031: Slash command runtime + 8 builtin (COMPLETED 2026-05-20)
[NEW, CRITICAL] 032: askUser modal + IPC (COMPLETED 2026-05-20)
[NEW, HIGH] 033: Sessions tree + fork + rewind (in-memory) (COMPLETED 2026-05-20)
  Note: 持久化升级在 v0.1.6 F038 完成
[NEW, HIGH] 034: AGENTS.md auto-load + 显示 (COMPLETED 2026-05-21)
[NEW, HIGH] 035: Skills 发现 + 执行 (COMPLETED 2026-05-21)
[NEW, HIGH] 036: MCP 管理 UI (read-only listing) (COMPLETED 2026-05-21)
  Note: 完整版（start/stop/log/tool catalog）在 v0.1.7 F039
[NEW, HIGH] 037: Subagent tree 视图 (COMPLETED 2026-05-21)
[REFACTOR, HIGH] 038: F033 Sessions 持久化升级 (COMPLETED 2026-05-22)
  Note: SDK 0.7.42 /session subpath；in-flight 仍 in-memory，historical 走 SDK 持久化

=== SUMMARY ===
Total: 39 | Planned: 15 | InProgress: 0 | Completed: 21
By Priority: Critical: 13 (✅12/13), High: 17 (✅8/17), Medium: 8, Low: 1
By Category:  New: 31, Enhancement: 3, Refactor: 4, Internal: 2

--- REMAINING PLANNED ---

v0.1.1 originals (2): F011 terminal popout, F014 napi tokenizer
v0.1.2 生态打通 (4): F015 Repointel, F016 lineage 图, F017 CLI teleport, F018 Quick Ask
v0.1.3 UX polish (4): 主题 / 通知 / .mcpb / 自动更新
v0.1.4 power (4): 多 tab 终端 / 富预览 / NAPI native-diff + fuzzy
v0.1.5 release (2): 签名 + notarize / 文档
v0.1.7 (1): F039 MCP 完整版 (等 SDK MCP manager runtime API)
```

## Version Roadmap

| Version | Theme | Done When | Target |
|---------|-------|-----------|--------|
| **v0.1.0** | Alpha foundation | 在桌面跑 KodaX session，发消息、看 tool call、批准权限、看 diff | 2026-Q2 |
| **v0.1.1** | Productivity baseline | 内置终端 + Subagent 可视化 + MCP 管理 + 第一个 Rust 加速器 | 2026-Q2 末 |
| **v0.1.2** | KodaX 生态打通 | Repointel + session lineage + CLI ↔ Space teleport + Quick Ask | 2026-Q3 中 |
| **v0.1.3** | UX polish | 主题 + 通知 + `.mcpb` 安装 + 自动更新 | 2026-Q3 末 |
| **v0.1.4** | Power features | 多 tab 终端 + 富文件预览 + 更多 Rust 加速器 | 2026-Q4 初 |
| **v0.1.5** | Release-ready | 签名 + notarize + 文档站；准备 v0.2.0 公开 Beta | 2026-Q4 |
| **v0.1.6** | Persistence follow-up | F033 sessions tree/fork/rewind 升 KodaX SDK 持久化 API（in-memory → 磁盘） | 与 KodaX SDK ≥ 0.7.42 同步 |
| **v0.1.7** | MCP management follow-up | F036 MCP popout 升级（read-only → start/stop/log/tool catalog） | 与 KodaX SDK MCP manager 公开 API 同步 |

## ID Conventions

- 数字从 001 开始递增；版本不影响 ID 序号
- 每个 feature 设计文档锚点为小写 + 中划线
- Status 变更时同时更新 Index 表与对应 design doc

## Dependencies (高级)

```text
F001 ─► F002 ─► F003 ─► F005 ─► F006 ─► F007
                  │       │       │       │
                  ▼       ▼       ▼       ▼
                F004    F009    F008    F010
                          │
                          ▼
                        F011, F012, F013, F014
                                  │
                                  ▼
                        F015, F016, F017, F018
                                  │
                                  ▼
                        F019..F022 → F023..F026 → F027..F028
```

每层完成是下一层的前置。同层 feature 大致可并行。

## References

- [PRD](PRD.md) — 产品需求
- [HLD](HLD.md) — 高层设计
- [ADR-001 Shell Electron](ADR/ADR-001-shell-electron.md)
- [ADR-002 Rust NAPI 策略](ADR/ADR-002-rust-integration-napi.md)
- [ADR-003 KodaX 集成模式](ADR/ADR-003-kodax-integration-in-process.md)
- [ADR-004 面板模型](ADR/ADR-004-panel-model.md)
