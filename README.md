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

# 仅构建（不打包安装包）
npm run build:smoke

# 完整构建 + 打包安装包（unsigned dev build，签名留 v0.1.5）
npm run build
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

v0.1.0-alpha.0 — Electron 工程骨架（[FEATURE_001](docs/features/v0.1.0.md#feature_001-electron-工程骨架)）

下一步：FEATURE_002 IPC schema (zod)。

## License

[Apache 2.0](LICENSE) © 2026 icetomoyo
