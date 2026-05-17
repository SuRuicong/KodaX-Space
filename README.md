# KodaX Space

> Provider-neutral, local-first AI agent desktop client — KodaX 生态桌面客户端

[![status](https://img.shields.io/badge/status-alpha-orange)]() [![license](https://img.shields.io/badge/license-Apache--2.0-blue)]() [![version](https://img.shields.io/badge/version-0.1.0--alpha.0-lightgrey)]()

KodaX Space 是 [KodaX](../KodaX) 生态的 Electron 桌面客户端。对标 Anthropic Claude Desktop / OpenAI Codex Desktop，但 Provider 中立、开源、本地优先。

- **12+ LLM Provider 自由切换**（不锁 Anthropic / 不锁 OpenAI）
- **本机优先**（数据默认本地，不强制云）
- **复用 KodaX 内核**（in-process import，REPL 同源演进）
- **Repointel 仓库智能集成**（自动激活仓库前置上下文）
- **跨 surface session 漂移**（CLI ↔ Space 文件级 teleport）

## Documentation

- [PRD.md](docs/PRD.md) — 产品需求
- [HLD.md](docs/HLD.md) — 高层设计
- [ADR/](docs/ADR/) — 关键架构决策（Electron / 集成模式 / Rust 策略 / 面板模型）
- [FEATURE_LIST.md](docs/FEATURE_LIST.md) — 28 features 跨 v0.1.0–v0.1.5

## Development

```bash
# 装依赖
npm install

# 开发模式（vite HMR + esbuild watch + electron）
npm run dev

# 单元测试 + 类型检查
npm test && npm run typecheck

# 仅构建 dist (不打包安装包)
npm run build:smoke

# 完整构建 + 打包平台安装包（unsigned dev build，签名留 v0.1.5）
npm run build:win        # Windows NSIS .exe
npm run build:mac        # macOS universal .dmg
npm run build            # 当前平台（CI matrix 用）
npm run smoke:pack       # 校验 installer size + asar 内容
```

## Project Layout

```
KodaX-Space/
├── apps/
│   └── desktop/
│       ├── electron/         ← main + preload (Node)
│       └── renderer/         ← React UI (browser, sandbox)
├── packages/
│   ├── space-ipc-schema/     ← zod schemas for IPC (single source of truth)
│   └── space-ui-kit/         ← shared design primitives
├── scripts/                  ← build / dev / clean
├── docs/                     ← PRD · HLD · ADR · features
└── .github/workflows/        ← CI
```

## Status

**v0.1.0-alpha.0 — Alpha foundation 完成 ✅** （10/10 features）

| # | Feature | 落地状态 |
|---|---------|---------|
| 001 | Electron 工程骨架 | ✓ |
| 002 | IPC schema (zod) | ✓ |
| 003 | Main 进程 KodaX runtime 集成 | ✓ Mock adapter |
| 004 | Provider 配置 GUI + Keychain | ✓ 13 built-in + custom + keytar fallback |
| 005 | 项目与 Session 管理 UI | ✓ |
| 006 | 对话流 UI + tool call 渲染 | ✓ |
| 007 | Permission 弹窗组件 | ✓ ask-and-wait + typed-confirm |
| 008 | Work 进度 + reasoning mode 切换 | ✓ |
| 009 | 文件面板（Monaco read-only + diff） | ✓ |
| 010 | 跨平台安装包（unsigned dev） | ✓ Win/macOS via electron-builder |

**这一版能做什么**：装好 alpha 安装包后，配一个 LLM provider key → 选项目目录 → 创建 session → 跟 mock agent 对话 → 看 token 流式输出 + tool call 卡片 → 工具调用前权限弹窗确认 → 文件面板看树/读文件 → tool_call write/edit 时自动跳 diff 视图。reasoning mode / provider / Work 预算可在 TopBar 实时切换/查看。

下一步：v0.1.1 — Productivity baseline（内置终端 + Subagent tree + MCP 管理 + NAPI tokenizer）。

## License

[Apache 2.0](LICENSE) © 2026 icetomoyo
