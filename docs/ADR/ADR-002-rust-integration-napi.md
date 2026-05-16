# ADR-002: Rust 集成策略 — NAPI-RS 选择性热路径

- **Status**: Accepted
- **Date**: 2026-05-16
- **Companion**: [HLD §11.1.3](../HLD.md#1113-cnapi-rs-的具体候选)
- **Depends on**: [ADR-001](ADR-001-shell-electron.md)

## Context

KodaX Space 走 Electron + Node + TS 后，Rust 仍可能在两类位置发挥价值：

1. **桌面壳**（Tauri 替代 Electron）
2. **Node 内的热路径模块**（通过 NAPI-RS 编译为 `.node`，从 TS import）

需要决策：是否引入 Rust？引入到哪？引入多少？

## Decision

**采用 A+C 模式：Electron + Node + 按需 NAPI-RS 热路径模块**。

- 默认不引入 Rust
- 当**有 profile 证据**显示某个纯计算 hot path 占比显著时，把该单点用 Rust crate 重写，通过 NAPI-RS 暴露为 Node 原生模块
- 每个 NAPI crate 独立 cargo 项目、独立发版、独立测试
- 不引入 Cargo workspace
- 每个 crate 必须**可被未来的 kodax-rs 直接 `use`**（不暴露 NAPI-specific API），作为可能的 Rust 化路径种子

## Rationale

### 为什么 A+C 优于其他 Rust 引入方式

| 方案 | 含义 | 评价 |
|---|---|---|
| **A**（不用 Rust） | 纯 TS | ❌ 热路径性能封顶；token 计数等 first-day UI feature 慢 |
| **A+C**（NAPI 选择性） | TS 主导 + Rust 加速器 | ✅ 渐进、可逆、按 profile 加 |
| B（Tauri + Node sidecar） | 壳 Rust + agent TS | ❌ 见 ADR-001：Rust 收益空，OpenCode 实证退路 |
| B+C（Tauri + Node sidecar + NAPI） | 上者 + Rust 加速器 | ❌ 继承 B 的死结，加 NAPI 不救 |
| D（Full Rust rewrite） | 壳+agent 全 Rust | ⚠️ 6-12 月承诺；见下方 |

### A+C 的核心收益

1. **真实瓶颈点直接消灭**：token 计数（每次 UI 显示）、大 diff（write/edit 大文件）、fuzzy search（@-mention）这些是 KodaX 已知热路径
2. **零架构改动**：sidecar 仍是 Node，调用方式仍是 `import`，只是某些函数底层是 Rust
3. **每个 crate 独立可逆**：撤回某个 NAPI 模块只是改一行 import
4. **团队渐进学 Rust**：先学 NAPI 子集（最小子集），不被 Tauri 桌面框架的复杂度淹没
5. **D 的种子**：如果未来走 D，每个 NAPI crate **直接是** kodax-rs 内核的一个 module。不浪费

### 候选清单（按性价比）

| 候选 NAPI crate | 当前 TS 实现 | Rust crate | 收益 | 引入时机 |
|---|---|---|---|---|
| `@kodax-ai/native-tokenizer` | `js-tiktoken` | `tiktoken-rs` | 10× | **M0 末**（token 计数是 first-day UI feature） |
| `@kodax-ai/native-diff` | 自实现 | `imara-diff` / `similar` | 5-20× on 大文件 | M1（用户反馈大 diff 慢时） |
| `@kodax-ai/native-fuzzy` | — | `nucleo` | 数量级 | M1（@-mention 文件选择器需要时）|
| `@kodax-ai/native-jsonl` | 自实现 | `simd-json` | 3-5× | M2（大 session resume 慢时）|

**引入规则**：

- ❌ 不为 Rust 而 Rust；每个 crate 必须有具体 profile 证据
- ❌ 不创建 Cargo workspace（每个 crate 独立 build，避免耦合）
- ❌ 不暴露 NAPI-specific API；crate 内部必须可作为纯 Rust crate 使用
- ✅ 每个 crate 必须发到 npm 时按 platform-specific 包（Win x64/arm64 + Mac x64/arm64 + Linux x64/arm64 = 6 包），用 `optionalDependencies` 解析

### 真实代价

每个 NAPI crate 引入：

- +1-2 周工程（crate 写 + 类型绑定 + 6 平台 build 矩阵 + CI 配置）
- 6 个平台原生包发到 npm
- 团队需要至少 1 人会 Rust NAPI 子集
- CI release 时间每 crate +5-10 min

3 个 crate 是 reasonable 上限；超过后维护成本快速上升。

## 未来路径：D（全 Rust 重写）

A+C **不是 D 的承诺**。但 A+C 是**走到 D 的最短路径**，原因：

- 每个 NAPI crate（无 NAPI-specific API 约束下）就是 Rust 内核的一个 module
- 团队的 NAPI Rust 经验可平滑迁移到 native Rust
- D 启动时，已有的 NAPI crate 直接 import 进 kodax-rs，不重写

**D 的启动判据**（同时满足才考虑）：

1. 产品愿景明确转向 "AI 工具圈的 Zed"（性能 + native + 本地推理是首要卖点）
2. KodaX 协议契约（ACP / Repointel / MCP host）经 6 个月稳定不变
3. 至少 1 位团队成员有桌面 Rust 经验
4. KodaX-private 反逆向变成业务关键路径
5. **国内 6 个 provider** (智谱/Kimi/通义/MiniMax/MiMo/Ark) 在 Rust 生态有 ≥ 2 个出现可用 SDK

启动模式：**双轨制 second implementation**——保留 KodaX TS，新建 kodax-rs，逐步替换。不停 ship。

## Consequences

### 接受

- 引入 Rust 工具链 + cargo build 时间
- 每个 NAPI crate 需 6 平台 build matrix
- 每次 release CI 时间 +5-10 min/crate
- 团队需要 NAPI 子集 Rust 知识

### 获得

- 真实热路径数量级加速
- 团队渐进 Rust 经验
- D 路径的天然种子
- 不为 Rust 而 Rust 的克制

## Reconsider When

- 某个 hot path profile 占比 < 5%——重审是否值得 Rust 化
- NAPI crate 数 > 3——重审是否应启动 D
- Cargo workspace 跨 crate 依赖出现——可能需要架构演进
- D 启动判据 5 条全部满足——启动 Track 2

## References

- [napi-rs 官方文档](https://napi.rs/)
- [tiktoken-rs](https://github.com/zurawiki/tiktoken-rs)
- [imara-diff](https://github.com/pascalkuthe/imara-diff)
- [nucleo (helix 同款)](https://github.com/helix-editor/nucleo)
