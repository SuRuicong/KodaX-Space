# ADR-003: KodaX 集成模式 — in-process import

- **Status**: Accepted
- **Date**: 2026-05-16
- **Companion**: [HLD §1–§5](../HLD.md)
- **Depends on**: [ADR-001](ADR-001-shell-electron.md)

## Context

KodaX Space 是 KodaX 生态的桌面客户端。Space main 进程与 KodaX agent runtime 之间的集成方式有完整的 6 模式光谱：

| 模式 | 含义 | 进程数 | 跨语言 | 调用开销 | 崩溃隔离 |
|---|---|---|---|---|---|
| **A. In-process import** | main 直接 `import` KodaX SDK | 1 | ❌ | ns | ❌ |
| **B. utilityProcess** | Electron 22+ 轻量 Node 子进程 + MessagePort | 2 | ❌ Node-only | µs | ✅ |
| **C. child_process.fork** | 老 Node IPC channel | 2 | ❌ Node-only | µs | ✅ |
| **D. spawn + 自研 JSON-RPC** | 子进程 + 自定义协议（如 Codex App Server） | 2 | ✅ | µs | ✅ |
| **E. spawn + ACP** | 同 D，但用 ACP 标准协议 | 2 | ✅ | µs | ✅ |
| **F. spawn + HTTP/SSE** | HTTP 服务做 sidecar | 2 + HTTP | ✅ | ms | ✅ |

### 业界三家真实做法

| 产品 | 模式 | 备注 |
|---|---|---|
| **Claude Code Desktop** | A（in-process）| Anthropic first-party UI；Electron main 直接 import Claude Agent SDK |
| **Codex Desktop** | D（spawn + Codex App Server JSON-RPC over JSONL stdio）| 同一 server 服务 6 个 surface（CLI/VS Code/JetBrains/Xcode/Web/Desktop）|
| **OpenCode**（新版）| A（in-process）| 从 F→A 反向迁移；2026-04 切到 Electron 嵌入 Node |
| **OpenCode**（旧 Tauri 版）| F（HTTP/SSE） | 已淘汰 |
| **Cursor / Windsurf / Cline** | A（VS Code 扩展进程内）| 扩展 host 即 agent runtime |
| **Zed → Claude Code** | E（ACP）| Zed 是 Rust，必须跨语言 |

**关键观察**：Codex 选 D（协议），因为他们要"一份 server 服务多个 host"（CLI / IDE / Desktop 共享同一 agent server）。Claude Code 和 OpenCode 都是"一份 SDK + 各 host 自己跑"，所以 A。

## Decision

**采用模式 A（in-process import）作为默认**，保留模式 B（utilityProcess）作为崩溃隔离 fallback。**不**采用 D / E / F。

- Electron main 进程直接 `import` KodaX SDK 的 stateful API（`runKodaX` / `KodaXClient` / tool 执行）
- Renderer 通过 Electron IPC（zod-validated channel）与 main 通信，**不**直接 import KodaX runtime
- Stateless 工具与类型（`estimateTokens` / `KODAX_PROVIDERS` / type definitions）也由 main 直接 import；renderer 仅 import 类型
- **保留 utilityProcess 作为 fallback**：未来若长 session 内存或崩溃隔离成为问题，可单点切换某个 session 类型到 utilityProcess，不改架构（renderer 无感知）
- **ACP server 由 KodaX 内核继续维护**，但仅服务**第三方 host**（Zed、Claude Code Desktop、OpenCode 等）；Space 不通过 ACP 接 KodaX

## Rationale

### 为什么 in-process

1. **与 KodaX REPL 同源**：REPL（`@kodax-ai/repl`）就是"同进程 import KodaX SDK + Ink 渲染"。Space 用 React 替换 Ink，但架构模型一致——内核团队改 SDK，Space 立刻享受
2. **类型端到端**：TS 类型不被任何序列化边界切断
3. **调试简单**：单进程单栈，断点直接打
4. **零协议层维护**：不需要定义 zod schema 给 ACP 消息，不需要协议版本协商
5. **OpenCode 验证**：OpenCode 把桌面从 Tauri+Node sidecar 切到 Electron+embedded Node 时给的理由就是这个——"Electron desktop app can easily **embed it without spawning another process**"
6. **Iteration speed 最大**：HMR、单文件改动立刻生效；不需要重启 sidecar

### 为什么不选 E（ACP）

ACP 的真正价值是**多 host 共享同一 agent server**——让 Zed / Claude Code Desktop / 第三方 IDE 都能接 KodaX。Space 是 KodaX 团队自家 UI，**不是 ACP 的目标客户**。

**对 Space 来说 ACP 是过度工程**：

| 我曾给的 ACP 理由 | 重审 |
|---|---|
| "Electron main 是 OS event loop owner，跑 agent 会卡 UI" | **夸大**。KodaX 95% 是 async I/O；CPU busy 时刻极少。REPL 同进程跑 agent 也没卡。Claude Code Desktop 用 A 模式，没问题 |
| "Tool 执行卡 main" | **站不住**。bash 是 spawn 子进程不阻塞；write/edit 是 async fs |
| "崩溃隔离" | nice-to-have，不是 must；可用 B（utilityProcess）按需获得 |
| "长 session 内存压力拖累 UI" | renderer 是独立进程，UI 帧率不受 main 内存影响 |
| "CLI ↔ Space session 漂移要求 ACP" | **搞错了**。漂移靠 `~/.kodax/sessions/<id>.jsonl` 文件做，不需要 ACP |
| "Rust 转型路径需要协议解耦" | **半真**。Rust 化时是 Tauri + Rust agent 一起重写，Space 跟 Rust SDK 直接 import，跟 ACP 也无关 |
| "MCP 强制存在子进程基础设施" | MCP 是 KodaX 内部的事，跟 Space 无关 |

### 为什么不选 D（自研 JSON-RPC，Codex 风格）

Codex 选 D 是因为他们要"一份 App Server 服务 6 个 surface"。KodaX Space 是**一对一**关系（Space 一个 host，KodaX 一份 SDK），不需要协议层做多 host 抽象。如果未来 KodaX 决定走 Codex App Server 路线，Space 可以平滑切到 D，**但 M0 不需要**。

### 为什么不选 F（HTTP/SSE）

OpenCode 用真金白银实证过：HTTP-sidecar 在 Windows 上不稳，开销大于 stdio。已被淘汰，不重新踩。

### 为什么 B（utilityProcess）只作 fallback 不作默认

B 比 A 多一层 MessagePort 通信成本（µs 级），但 M0 阶段：
- KodaX runtime 还没暴露明显的崩溃 / 内存问题
- 一个进程更易调试，HMR 友好
- Claude Code Desktop 用 A 工作得好

如果 M1/M2 出现下列证据，再升 B：
- Space 崩溃工单 > 5%
- 长 session（context > 500K tokens）UI 卡顿 profile 证实
- 多并行 session 内存压力可见

升 B 的改动量很小：把 KodaX runtime 调用包成 MessagePort 消息传递；renderer 完全无感知。所以现在不为假想需求付成本。

### 为什么默认不用 utilityProcess

`utilityProcess` 是 Electron 22+ 提供的轻量子进程 API。优点：进程隔离 + 保留 TS 类型（通过 MessagePort + structured clone）。缺点：多一层消息传递 + 类型同步要小心。

**不默认用，但留作 fallback**。M0 in-process 验证后，如果出现：

- 用户报告：Space 偶尔崩溃，丢未保存对话
- profile 显示：长 session 时 UI 卡顿、GC 频繁

→ 单点把"agent 执行"迁到 utilityProcess。改动量小（把 `runKodaX` 调用包成 message 传递），renderer 完全无感知。

### KodaX 包结构的最佳利用

KodaX 已有 5 个 SDK subpath（`/agent` `/llm` `/coding` `/repl` `/skills`），完全 import-friendly。Space 用法：

| KodaX 包 | Space main import | Space renderer import |
|---|---|---|
| `@kodax-ai/kodax/coding` (runKodaX, KodaXClient) | ✅ stateful 也 import | ❌ |
| `@kodax-ai/kodax/llm` (estimateTokens, KODAX_PROVIDERS, type) | ✅ | ✅ 仅类型 |
| `@kodax-ai/kodax/skills` | ✅ | ❌ |
| `@kodax-ai/kodax/agent` (Runner, types) | ✅ | ✅ 仅类型 |
| `@kodax-ai/kodax/repl` (Ink TUI) | ❌ terminal-only，Space 自己写 UI | ❌ |

**renderer 不变量**（CI 强制）：
- ❌ renderer bundle 不含 `@anthropic-ai/sdk` / `openai` / 任何 LLM runtime
- ❌ renderer bundle 不含 `runKodaX` / `KodaXClient` runtime
- ✅ renderer bundle 仅含 KodaX 类型 + 常量

Main 不变量（CI 强制）：
- ✅ Main 可 import KodaX 全部 API
- ❌ Main 不可有任何 KodaX 包的 fork 或复制实现

## Consequences

### 接受

- KodaX runtime 崩溃可能拖累整个 Space（mitigation：未来按需切 utilityProcess）
- 长 session 内存堆在 main 进程（mitigation：observability 监控）
- Space 与 KodaX 版本必须 npm semver 兼容（不能像 ACP 那样跨版本）

### 获得

- 最简单架构、最快 iteration
- 端到端 TypeScript 类型
- KodaX 内核演进同步无缝
- 调试单栈、HMR 友好
- 无协议层维护成本

## ACP 在 KodaX 生态的定位（澄清）

- ACP server 仍是 KodaX 内核的一等公民
- 服务对象：Zed、Claude Code Desktop、未来其他 IDE / 桌面 host
- Space 不用 ACP——Space 不是 ACP 的 host，是 KodaX 的 first-party UI
- Cross-surface continuity（CLI ↔ Space）通过 `~/.kodax/sessions/` 文件 + handoff 文件实现，不通过 ACP

## Reconsider When

- 出现"Space 崩溃带走未保存数据"工单 > 5%——评估切 utilityProcess
- 长 session（context > 500K tokens）UI 卡顿 profile 证实——评估切 utilityProcess
- KodaX 内核与 Space 想异步独立 release——考虑切 ACP，使 Space 与 KodaX 版本松耦合
- 走 D（Full Rust）——Space 改 spawn `kodax-rs` binary，不再 import；那时切到 ACP 或自定义 IPC

## References

- KodaX 现有 ACP server: `KodaX/src/acp_server.ts`
- KodaX REPL（同进程 import 参考实现）: `@kodax-ai/repl`
- [Electron utilityProcess docs](https://www.electronjs.org/docs/latest/api/utility-process)
- [Agent Client Protocol SDK](https://www.npmjs.com/package/@agentclientprotocol/sdk)
