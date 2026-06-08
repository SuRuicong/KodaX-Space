# KodaX Space

> Provider-neutral, local-first AI agent desktop client — KodaX 生态桌面客户端

[![status](https://img.shields.io/badge/status-stable-green)]() [![license](https://img.shields.io/badge/license-Apache--2.0-blue)]() [![version](https://img.shields.io/badge/version-0.1.9-blue)]()

KodaX Space 是 [KodaX](../KodaX) 生态的 Electron 桌面客户端。对标 Anthropic Claude Desktop 中的 Claude Code，Provider 中立、开源、本地优先（[ADR-004](docs/ADR/ADR-004-panel-model.md)）。

- **12+ LLM Provider 自由切换**（不锁 Anthropic / 不锁 OpenAI）
- **本机优先**（数据默认本地，不强制云）
- **复用 KodaX 内核**（in-process import，REPL 同源演进）
- **图片粘贴多模态输入**（v0.1.9，截图直接粘到 composer → SDK `KodaXContextOptions.inputArtifacts`）
- **Smart Popout Director**（v0.1.9，session 首次出现 plan/diff/tasks 信号自动展开右侧 popout）
- **统一 Settings + Codex parity 视觉**（v0.1.9，2-tab Settings modal / 可拖侧栏 / 项目拖排）
- **真 PTY 多 tab 终端**（v0.1.7，xterm.js + node-pty）
- **PDF / docx / xlsx 富预览**（v0.1.7，lazy-loaded 不影响 main bundle）
- **⌘Shift+P 命令面板**（v0.1.7，VS Code 同款）

## Documentation

- [USAGE.md](docs/USAGE.md) — 用户使用文档（启动 / 配置 / 主要功能 / 已知限制）
- [PRD.md](docs/PRD.md) — 产品需求
- [HLD.md](docs/HLD.md) — 高层设计
- [ADR/](docs/ADR/) — 关键架构决策（Electron / 集成模式 / Rust 策略 / 面板模型 / Partner surface）
- [FEATURE_LIST.md](docs/FEATURE_LIST.md) — features 跨 v0.1.0–v0.1.9（账本 + Completed / Partial / Deferred 状态）
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

**v0.1.9 — Multimodal input + smart popout director + Codex parity polish ✅**（2026-06-08 ship，合并 v0.1.8）

最新 release 一次发了 9 项新增 + 关键 SDK 0.7.46 适配。v0.1.8 内容（CSP / HelpOverlay 跨平台 / e2e gate / F043 项目 contextmenu / OC-21 ToolRegistry / KX-I-05 权限批处理 modal）合并进本版 binary。

### v0.1.9 主要新增

| Feature | 描述 |
|--|--|
| **OC-31** | 图片粘贴多模态输入（clipboard PNG/JPEG/WEBP → SDK `KodaXContextOptions.inputArtifacts`） |
| **KX-I-02** | Smart Popout Director（首次出现 plan/diff/tasks 信号自动展开右侧 popout，每 session 一次） |
| **OC-29** | Unified Settings modal（2-tab Preferences / Providers，hidden 模式不 unmount 保留编辑） |
| **F040 拖排** | 项目 row HTML5 DnD 拖排 + Archived 折叠状态持久化（current 仍 pin 顶） |
| **F040 cap** | 项目 session 默认 8 条上限 + ProjectSessionPicker overlay |
| **Codex parity** | 左/右侧栏可拖（180-520px）+ 默认更宽 + 基础字号 [13px] |
| **OC-21** | result-side ToolRegistry（对称 v0.1.8 input-side，预留扩展位） |
| **SDK 升级** | `@kodax-ai/kodax` 0.7.45 → 0.7.46（FEATURE_219 真 archive + cross-project filter 修） |

### v0.1.10（planning）

| Feature | 描述 |
|--|--|
| **F044** | 右侧 Changes 点文件打开 git working-tree diff popout（fallback tool-call cache miss 时走 git CLI） |
| chore | 启动期 best-effort 清理早期残留 `~/.kodax_space` 孤儿目录 |

### 历史 release

| Version | Theme | Date |
|--|--|--|
| v0.1.9 | Multimodal input + smart popout + Codex parity（含 v0.1.8 合并） | 2026-06-08 |
| v0.1.7 | Terminal + Preview + Command palette（含 v0.1.6） | 2026-06-06 |
| v0.1.5 | Sidebar overhaul + review closeout（含 v0.1.4） | 2026-06-05 |
| v0.1.3 | UX polish（主题 / 通知 / 自动更新） | 2026-Q3 |
| v0.1.2 | KodaX 生态打通 | 2026-06-01 |
| v0.1.1 | TUI 对齐 batch | 2026-Q2 末 |
| v0.1.0 | Alpha foundation | 2026-Q2 |

详细历史 → [CHANGELOG.md](CHANGELOG.md) / [FEATURE_LIST.md](docs/FEATURE_LIST.md)

### 当前能做什么

装好安装包（或源码 `npm run dev`）后：

1. **配 LLM provider key**（齿轮 ⚙ → Providers；13 内建 + 自定义；keytar 或 in-memory fallback）
2. **选项目目录**（左侧栏 + New / Open；F005 allowlist 保护所有 path 类 IPC）
3. **创建 session 跟 AI 对话**（流式 token + tool call 卡片 + reasoning mode 切换）
4. **粘贴截图给 AI 看**（Ctrl+V 把 PNG/JPEG/WEBP 粘到 composer，SDK 自动拼 multimodal content）
5. **Plan/Diff/Tasks 自动开**（首次出现信号时自动展开右侧 popout，Preferences 里可关）
6. **真 PTY 终端**（右上 Toolbar 终端图标；多 tab；cross-platform）
7. **打开任意文件预览**（PDF/docx/xlsx 走 RichPreview；其它走 Monaco read-only）
8. **⌘K Quick Ask 临时问 / ⌘Shift+P 命令面板导航**
9. **Permission 弹窗确认每个写工具**（plan / accept-edits / auto 三档模式；多请求自动批 modal）
10. **fork / rewind session**（SDK 0.7.42 持久化，跨 REPL 共享）
11. **拖排项目 + 拖宽侧栏**（lastUsedAt 默认 / 用户拖动覆盖；左 260/右 320 默认可拖到 180-520px）

### 已知限制

- F015 Repointel warm API / F017 CLI teleport / F018 Quick Ask 完整 PRD：明确 Deferred 等 SDK 接口
- 历史 session 点右侧 Changes 看 diff：v0.1.9 仍指着 tool-call cache（cache miss → "No diff available"），**v0.1.10 F044 加 git working-tree fallback**
- F014 NAPI tokenizer：并入 F042 待性能数据驱动
- F042 NAPI helpers / Partner surface (F045-F053)：在 roadmap
- 未签名 installer：Win SmartScreen / macOS Gatekeeper 首启警告需手动 Open

### 不签名说明

KodaX Space 定位为**自家与可信用户使用**，不走"陌生人公开 Beta"路径，installer 无 OS 级签名 / 公证。
首次启动 Win SmartScreen / macOS Gatekeeper 警告需手动 Open 接受。

## License

[Apache 2.0](LICENSE) © 2026 icetomoyo
