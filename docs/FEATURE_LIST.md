# KodaX Space Feature List

> Last Updated: 2026-05-17 (FEATURE_001, FEATURE_002, FEATURE_003, FEATURE_005, FEATURE_006 completed)
> Source of truth: [PRD](PRD.md) · [HLD](HLD.md) · [ADR/](ADR/)
> Versions: v0.1.0 → v0.1.5（M0–M1，约 3–4 个月）

## Index

| ID | Title | Category | Priority | Version | Status | Design |
|----|-------|----------|----------|---------|--------|--------|
| 001 | Electron 工程骨架 | New | Critical | v0.1.0 | Completed | [v0.1.0.md#001](features/v0.1.0.md#feature_001-electron-工程骨架) |
| 002 | IPC schema (zod) | New | Critical | v0.1.0 | Completed | [v0.1.0.md#002](features/v0.1.0.md#feature_002-ipc-schema-zod) |
| 003 | Main 进程 KodaX runtime 集成 | New | Critical | v0.1.0 | Completed | [v0.1.0.md#003](features/v0.1.0.md#feature_003-main-进程-kodax-runtime-集成) |
| 004 | Provider 配置 GUI + Keychain | New | Critical | v0.1.0 | Planned | [v0.1.0.md#004](features/v0.1.0.md#feature_004-provider-配置-gui--keychain) |
| 005 | 项目与 Session 管理 UI | New | Critical | v0.1.0 | Completed | [v0.1.0.md#005](features/v0.1.0.md#feature_005-项目与-session-管理-ui) |
| 006 | 对话流 UI + tool call 渲染 | New | Critical | v0.1.0 | Completed | [v0.1.0.md#006](features/v0.1.0.md#feature_006-对话流-ui--tool-call-渲染) |
| 007 | Permission 弹窗组件 | New | Critical | v0.1.0 | Planned | [v0.1.0.md#007](features/v0.1.0.md#feature_007-permission-弹窗组件) |
| 008 | Work 进度 + reasoning mode 切换 | New | High | v0.1.0 | Planned | [v0.1.0.md#008](features/v0.1.0.md#feature_008-work-进度--reasoning-mode-切换) |
| 009 | 文件面板（Monaco read-only + diff） | New | High | v0.1.0 | Planned | [v0.1.0.md#009](features/v0.1.0.md#feature_009-文件面板monaco-read-only--diff) |
| 010 | 跨平台安装包（unsigned dev） | New | Critical | v0.1.0 | Planned | [v0.1.0.md#010](features/v0.1.0.md#feature_010-跨平台安装包unsigned-dev) |
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

## Status

```
=== FEATURE LIST ===
Last Updated: 2026-05-16

--- PLANNED (23) ---

v0.1.0 (alpha foundation): 5 features (10 total, 5 completed)
v0.1.1 (alpha+):            4 features
v0.1.2 (beta foundation):   4 features
v0.1.3 (beta polish):       4 features
v0.1.4 (release-ready):     4 features
v0.1.5 (release polish):    2 features

--- IN PROGRESS (0) ---

--- COMPLETED (5) ---

[NEW, CRITICAL] 001: Electron 工程骨架 (COMPLETED 2026-05-16)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
[NEW, CRITICAL] 002: IPC schema (zod) (COMPLETED 2026-05-16)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
[NEW, CRITICAL] 003: Main 进程 KodaX runtime 集成 (COMPLETED 2026-05-16)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
  Note: shipped Mock adapter; Real adapter (@kodax-ai/coding) tracked as chore
[NEW, CRITICAL] 005: 项目与 Session 管理 UI (COMPLETED 2026-05-16)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0
[NEW, CRITICAL] 006: 对话流 UI + tool call 渲染 (COMPLETED 2026-05-17)
  Planned: v0.1.0 → Released: v0.1.0-alpha.0

=== SUMMARY ===
Total: 28 | Planned: 23 | InProgress: 0 | Completed: 5
By Priority: Critical: 8, High: 11, Medium: 8, Low: 1
By Category:  New: 23, Enhancement: 3, Refactor: 2, Internal: 2
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
