# KodaX Space

> Provider-neutral, local-first AI agent desktop client — KodaX 生态桌面客户端

[![status](https://img.shields.io/badge/status-stable-green)]() [![license](https://img.shields.io/badge/license-Apache--2.0-blue)]() [![version](https://img.shields.io/badge/version-0.1.7-blue)]()

KodaX Space 是 [KodaX](../KodaX) 生态的 Electron 桌面客户端。对标 Anthropic Claude Desktop 中的 Claude Code，Provider 中立、开源、本地优先（[ADR-004](docs/ADR/ADR-004-panel-model.md)）。

- **12+ LLM Provider 自由切换**（不锁 Anthropic / 不锁 OpenAI）
- **本机优先**（数据默认本地，不强制云）
- **复用 KodaX 内核**（in-process import，REPL 同源演进）
- **真 PTY 多 tab 终端**（v0.1.7，xterm.js + node-pty）
- **PDF / docx / xlsx 富预览**（v0.1.7，lazy-loaded 不影响 main bundle）
- **⌘Shift+P 命令面板**（v0.1.7，VS Code 同款）

## Documentation

- [USAGE.md](docs/USAGE.md) — 用户使用文档（启动 / 配置 / v0.1.7 新功能 / 已知限制）
- [PRD.md](docs/PRD.md) — 产品需求
- [HLD.md](docs/HLD.md) — 高层设计
- [ADR/](docs/ADR/) — 关键架构决策（Electron / 集成模式 / Rust 策略 / 面板模型）
- [FEATURE_LIST.md](docs/FEATURE_LIST.md) — features 跨 v0.1.0–v0.1.7（账本 + Completed / Partial / Deferred 状态）
- [CHANGELOG.md](CHANGELOG.md) — 版本更新记录

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

# 完整构建 + 打包平台安装包（unsigned — 自家工具不走公开 Beta）
npm run build:win        # Windows NSIS .exe
npm run build:mac        # macOS universal .dmg
npm run build:linux      # Linux AppImage + .deb
npm run build            # 当前平台（CI matrix 用）
npm run smoke:pack       # 校验 installer size + asar 内容
```

## Project Layout

```
KodaX-Space/
├── apps/
│   └── desktop/
│       ├── electron/         ← main + preload (Node)
│       │   ├── terminal/     ← F011 ptyHost (node-pty wrapper)
│       │   └── ipc/          ← all IPC handlers
│       └── renderer/         ← React UI (browser, sandbox)
│           ├── shell/        ← Shell + popouts (Terminal / Preview / Diff / Tasks / Plan / MCP)
│           ├── features/     ← terminal (xterm) / preview (pdf/docx/xlsx) / session / quick-ask
│           └── lib/          ← fuzzy / shared utils
├── packages/
│   ├── space-ipc-schema/     ← zod schemas for IPC (single source of truth)
│   └── space-ui-kit/         ← shared design primitives
├── scripts/                  ← build / dev / clean
├── docs/                     ← PRD · HLD · ADR · features · USAGE · FEATURE_LIST · CHANGELOG
└── .github/workflows/        ← CI (build · release)
```

## Status

**v0.1.7 — Terminal + Preview + Command palette ✅**（2026-06-06 ship）

最新 release 把 v0.1.4 / v0.1.6 plan 里"等 KodaX SDK 出 X API 才能做"的三条主线
（真 PTY 终端、多 tab、富文件预览）一次性带上，并把命令面板顺带做了。

### v0.1.7 新增

| Feature | 描述 |
|--|--|
| **F011** | 真 PTY 单 tab 终端（xterm.js + node-pty；cross-platform shell；env allowlist 保护 API keys） |
| **F023** | 终端多 tab（10 cap；切走不丢 shell 状态） |
| **F024** | PDF / docx / xlsx 富预览（lazy chunks；main bundle 不变） |
| **F026** | ⌘Shift+P / Ctrl+Shift+P 命令面板（4 group：Actions / Sessions / Files / Slash） |
| **F038** | Sessions 持久化升级（接 KodaX SDK 0.7.42+，共享 `~/.kodax/sessions/`） |

### 历史 release

| Version | Theme | Date |
|--|--|--|
| v0.1.7 | Terminal + Preview + Command palette | 2026-06-06 |
| v0.1.5 | Sidebar overhaul + review closeout | 2026-06-05 |
| v0.1.3 | UX polish（主题 / 通知 / 自动更新） | 2026-Q3 |
| v0.1.2 | KodaX 生态打通 | 2026-06-01 |
| v0.1.1 | TUI 对齐 batch | 2026-Q2 末 |
| v0.1.0 | Alpha foundation | 2026-Q2 |

详细历史 → [CHANGELOG.md](CHANGELOG.md) / [FEATURE_LIST.md](docs/FEATURE_LIST.md)

### 当前能做什么

装好安装包（或源码 `npm run dev`）后：

1. **配 LLM provider key**（齿轮 → Providers；13 内建 + 自定义；keytar 或 in-memory fallback）
2. **选项目目录**（左侧栏 + New / Open；F005 allowlist 保护所有 path 类 IPC）
3. **创建 session 跟 AI 对话**（流式 token + tool call 卡片 + reasoning mode 切换）
4. **真 PTY 终端**（右上 Toolbar 终端图标；多 tab；cross-platform）
5. **打开任意文件预览**（PDF/docx/xlsx 走 RichPreview；其它走 Monaco read-only）
6. **⌘K Quick Ask 临时问 / ⌘Shift+P 命令面板导航**
7. **Permission 弹窗确认每个写工具**（plan / accept-edits / auto 三档模式）
8. **fork / rewind session**（SDK 0.7.42 持久化，跨 REPL 共享）

### 已知限制

见 [USAGE.md §6](docs/USAGE.md) — F015 warm API / F017 CLI teleport / F018 PRD 完整版 Quick Ask 等明确 deferred 项；F014 NAPI tokenizer 并入 F042 待性能数据驱动。

### 不签名说明

KodaX Space 定位为**自家与可信用户使用**，不走"陌生人公开 Beta"路径，installer 无 OS 级签名 / 公证。
首次启动 Win SmartScreen / macOS Gatekeeper 警告需手动 Open 接受。

## License

[Apache 2.0](LICENSE) © 2026 icetomoyo
