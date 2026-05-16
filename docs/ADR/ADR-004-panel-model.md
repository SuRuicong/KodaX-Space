# ADR-004: 面板模型 — 双面板 + Quick Ask

- **Status**: Accepted
- **Date**: 2026-05-16
- **Companion**: [PRD §1.1](../PRD.md#11-一句话定位), [PRD §5.1.1–§5.1.2](../PRD.md#51-must-havem0---m1)

## Context

KodaX Space 对标 Claude Desktop（Chat / Cowork / Code 三面板）与 Codex Desktop App（多 agent 单壳）。需要决策面板组织方式。

最初草案（v0.1）抄了 Claude Desktop 的三面板：Chat + Code + Partner。

## Decision

**采用双面板 + Quick Ask popover**：

- **Code 面板**（M0 起）：可视化的 KodaX coding agent，主舞台
- **Partner 面板**（M2 起）：对标 Claude Cowork，非编码 / 文档任务
- **Quick Ask popover**（M1 起）：全局热键唤出的浮窗，临时问答；无 session、无工具、无持久化

**不做独立 Chat 面板**。

## Rationale

### 为什么删 Chat 面板

1. **桌面 app 的独特价值 = 本机文件 + 工具执行**。Chat 在浏览器、各 provider 自家产品（claude.ai、智谱 BigModel、Kimi、深度求索、通义、豆包等）已 polished
2. **稀释价值主张**：把 chat 做进 Space 等于跟成熟 web chat 正面竞争——没有差异化护城河
3. **国内用户的 chat UI 习惯已被 provider 满足**——再做一份是负产出
4. **后端复杂度白送**：v0.1 写"Chat 不共享 Code 后端"已埋雷；删 Chat 消除此复杂度

### 为什么用 Quick Ask popover 替代

"临时问 LLM" 是真实需求（看陌生命令、查 API、快速 brainstorm），但**不需要一个 tab**：

- 形态：全局热键 `⌘⇧K` / `Ctrl+Shift+K`，独立 frameless 小窗
- 行为：临时 ACP-style session，强制 `mode='plan'`、无 MCP、不落盘、关闭即销毁
- 多聊？点 "Continue in Code panel as new session"，转 Code session（此时落盘）

### 为什么 M0 不显示 tab 切换器

M0 只有 Code 面板。M2 才有 Partner。**在只有 1 个面板时显示 tab 切换器是假繁荣**——给用户"功能未完成"的暗示。规则：

- M0–M1：顶部无 tab，直接是 Code workspace
- M2+：Partner 上线，顶部出现 `[Code] [Partner]` tab

### 替代方案与否决理由

| 方案 | 否决理由 |
|---|---|
| Chat + Code + Partner（Claude Desktop 三面板）| Chat 没差异化，见上 |
| 单面板 + 通过 mode 切换 | 把 coding 和 doc 任务硬塞一个布局，UI 复杂 |
| Code + Partner + Chat tab | 同 1 |
| Code + Partner（无 Quick Ask）| "临时问" 仍是真需求，无 popover 用户体验差 |
| **Code + Partner + Quick Ask popover** | ✅ 采纳 |

## Consequences

### 接受

- 用户期望"Space 也能 chat"时需引导到 Quick Ask 或 Code 面板新 session
- Quick Ask 是 M1 工作量
- Partner tab 上线时机紧绑 KodaX Partner 内核

### 获得

- 价值主张聚焦：本机 agent，不假装是通用 chat 客户端
- 后端实现简化（只有 Code session kind 真正落盘）
- 与 Claude Desktop 形成清晰差异化

## Reconsider When

- KodaX Partner 决定不做——Partner 面板需求消失，可能退化为单面板 + Quick Ask
- 用户工单中"找不到 chat tab"占比 > 10%——可能需要更显眼的"Continue in Code panel"引导
- 未来 KodaX 出现第三类 surface（如 BI / 数据分析 agent）——可能扩展到 3 面板

## References

- Claude Desktop 三面板设计：参 Anthropic 公开文档
- Claude Desktop 的 Quick Entry（macOS 全局热键）：本 ADR 的 Quick Ask 直接灵感来源
- Codex Desktop 单壳多 agent 设计：参 OpenAI 公开文档
