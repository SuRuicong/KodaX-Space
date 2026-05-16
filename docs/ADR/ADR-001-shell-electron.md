# ADR-001: Shell 技术栈 — Electron

- **Status**: Accepted
- **Date**: 2026-05-16
- **Companion**: [HLD §11](../HLD.md#11-技术栈决策)

## Context

KodaX Space 是 KodaX 生态的桌面客户端。桌面壳要求：

- 跨平台（Win / macOS / Linux）
- 嵌入 KodaX agent runtime（TypeScript）
- 富 UI（React + Monaco + xterm + 复杂状态）
- 兼容 Anthropic `.mcpb` 桌面扩展格式
- 自动更新、托盘、全局热键、native dialog

候选：Electron、Tauri、Wails (Go)、Neutralino、native（per-OS）。

## Decision

**采用 Electron + React + TypeScript**。

Main 进程（Node）直接嵌入 KodaX runtime，renderer 跑 React UI。

## Rationale

### 为什么 Electron 胜出

1. **与 KodaX 内核同源**：KodaX 是 TS/Node。Electron main 是 Node 进程，可直接 `import` KodaX SDK——零跨语言开销
2. **`.mcpb` 标准**：Anthropic 发布的 `.mcpb` 扩展规范是为 Electron 生态设计的；KodaX Space 与 Claude Desktop 同壳确保扩展生态兼容
3. **Windows 稳定性**：Electron 在 Win 上经 Slack/Discord/VS Code 多年生产验证；Tauri 路径需多管一个 Node sidecar 子进程，OpenCode 实证 Win 上不稳
4. **生态成熟**：自动更新（Squirrel）、签名/notarize、`utilityProcess` 等基础设施齐备
5. **团队学习曲线低**：当前团队 TS-only；不需新增 Rust shell 子生态

### 为什么不选 Tauri

| 维度 | Electron | Tauri | 选择 |
|---|---|---|---|
| KodaX TS 核心嵌入 | ✅ 直接 import | ❌ 必须 spawn Node sidecar | Electron |
| Windows 稳定性 | OpenCode 实证 ✅ | OpenCode 实证 ❌ | Electron |
| MCP 生态 | 成熟 | 新生 | Electron |
| `.mcpb` 兼容 | 完美 | 需自实现 | Electron |
| 包体积 | ~120 MB | ~80 MB（Tauri 壳 + Node sidecar）| Tauri（差距没想象大）|
| 内存 | 较高 | 较低 | Tauri |
| 默认安全模型 | 需手工加固 | 默认更严 | 通过 HLD §3.3 加固补齐 |

**关键判断**：Tauri 的 Rust 收益**只有在 agent 也是 Rust 时才被激活**。KodaX agent 是 TS，必须有 Node 进程；那么：

- Tauri 路径：壳 (Rust) + Node sidecar (TS) — 必须跨进程 IPC，多一层故障
- Electron 路径：壳 (Node) 直接嵌入 Node TS agent — 零 IPC，单进程

Tauri 的 "Rust 性能优势" 在此用法下是空的。

### 实证：OpenCode 反向迁移

OpenCode（sst / anomalyco，140K+ stars，与 KodaX 同位的 TS 核心 AI 编码 agent）：

- 2025 末桌面 v1 = Tauri + SolidJS + Rust 后端 + Node sidecar
- 2026-04-17 David Hill 宣布桌面切 Electron：*"faster and more reliable"*
- 2026-05-05 Brendan 公告：*"OpenCode Desktop is now running on Electron"*

SST 团队（dax / brendonovich / iamdavidhill）原话：

> "Getting the best performance out of Tauri requires implementing app logic in Rust, but since OpenCode is all written in TypeScript, **the server needs to run in a Node/Bun process regardless**, meaning any Rust used in Desktop **wouldn't move the needle on performance** without rewriting the entire core."
>
> "Node is way more stable on Windows... Electron desktop app can easily embed it **without spawning another process**."

KodaX Space 与 OpenCode 决策结构完全同构：TS 核心 + 桌面 UI。OpenCode 用真金白银走过一遍 Tauri 又切回 Electron，结论可直接复用。

### 为什么不选其他

- **Wails (Go)**：KodaX 核心是 TS，引入 Go 等于又开一个跨语言 boundary
- **Neutralino**：太新，生态不足
- **Native (per-OS)**：3 倍工作量，不可行
- **Full Rust rewrite (Tauri + Rust agent)**：见 [ADR-002](ADR-002-rust-integration-napi.md) — 这是一个独立的、6-12 月承诺的产品决策；如果未来要走，应当作为 Track 2 second implementation，不是 Space M0 的决定

## Consequences

### 接受

- 安装包 ~120 MB（用户首次下载较慢）
- 静态 RAM 较高（~120-200 MB 基线）
- 续航不如 native（但 KodaX 用户主要插电）
- 需手工加固 Electron 安全（contextIsolation、sandbox、CSP——见 HLD §3.3）

### 获得

- Win/macOS 一致体验 + Win 稳定
- KodaX SDK 端到端类型
- `.mcpb` 立即兼容
- 自动更新基础设施成熟
- 团队 TS 闭环

## Reconsider When

下列任一发生时重审此 ADR：

1. **Anthropic 把 Claude Desktop 切到非 Electron 栈**——生态信号变了
2. **用户工单中"安装包大 / RAM 高 / 续航差"占比 > 20%**——证据触发
3. **承诺走 Full Rust (D)**——此时考虑 Tauri 壳 + Rust agent 一起重写，见 [ADR-002 §未来路径](ADR-002-rust-integration-napi.md#未来路径d-全-rust-重写)

## References

- [OpenCode: Moving Desktop to Electron (Brendan, dev.to)](https://dev.to/brendonovich/moving-opencode-desktop-to-electron-4hip)
- [David Hill announcement, X (Apr 17, 2026)](https://x.com/iamdavidhill/status/2045133207645872376)
- [dax / SST rationale, X](https://x.com/thdxr/status/2024149757032100016)
- [OpenCode Desktop architecture (DeepWiki)](https://deepwiki.com/sst/opencode/6.7-desktop-application)
