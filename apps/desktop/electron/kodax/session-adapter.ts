// ManagedSession — KodaX runtime 在 main 端的统一接口面。
//
// 设计原则：F003 用 Mock 实现先把架构跑通。等 KodaX 发到 npm（或者本仓库 CI
// 加 sibling checkout 步骤）再加一个 RealKodaXSession 实现，包名出口是
// @kodax-ai/coding 的 KodaXClient + KodaXEvents。
//
// 一对一映射关系（详见 docs/features/v0.1.0.md FEATURE_003）：
//   KodaXEvents.onTextDelta      → emit({ kind:'text_delta',     ... })
//   KodaXEvents.onThinkingDelta  → emit({ kind:'thinking_delta', ... })
//   KodaXEvents.onToolUseStart   → emit({ kind:'tool_start',     ... })
//   KodaXEvents.onToolProgress   → emit({ kind:'tool_progress',  ... })
//   KodaXEvents.onToolResult     → emit({ kind:'tool_result',    ... })
//   KodaXEvents.onIterationEnd   → emit({ kind:'iteration_end',  ... })
//   KodaXEvents.onStreamEnd      → emit({ kind:'session_complete', ... })
//   (catch in agent.run)         → emit({ kind:'session_error',  ... })

import type { AgentMode, AutoModeEngine, InputArtifact, PermissionDecision, PermissionMode, SessionEvent, Surface } from '@kodax-space/space-ipc-schema';

/**
 * 工具调用前的权限请求回调。
 *
 * - session 实现（Mock / Real）在调用真实 tool 前调一次
 * - host 注入实现：转 PermissionBroker，broker 推 IPC 给 renderer，等用户决策
 * - 返回 'deny' → session **必须**放弃本次 tool 调用，emit 一条 tool_result 说明 "permission denied"
 * - 返回 'allow_once' / 'allow_always' → session 继续执行
 *
 * 即便 session 实现不接 permission 流（早期 Mock 或 Real adapter 不需要 gate 的工具），
 * 这个字段可以不调用——`session-adapter` 不强制每次 tool 都过 gate。
 */
export type PermissionRequestFn = (req: {
  readonly toolId: string;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
}) => Promise<PermissionDecision>;

export type SessionCreateOptions = {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly provider: string;
  readonly reasoningMode: 'off' | 'auto' | 'quick' | 'balanced' | 'deep';
  readonly permissionMode: PermissionMode;
  /** 仅 permissionMode === 'auto' 时生效；缺省 'llm'。FEATURE_029 */
  readonly autoModeEngine?: AutoModeEngine;
  /** AMA (默认) / SA — KodaX agent 形态。缺省 'ama'。*/
  readonly agentMode?: AgentMode;
  /** F045: 工作面（'code' = Coder / 'partner' = Partner）。缺省 'code'。持久化为 SDK session tag。*/
  readonly surface?: Surface;
  /**
   * 生效 model（创建时即带上）。undefined = 用 provider 默认。
   * 显式带上能让 SDK 应用该 model 的 per-model 能力（如真实 contextWindow），
   * 避免默认模型下 SDK 兜底到小窗口导致过早压缩（2026-06-15 用户复报）。
   */
  readonly model?: string;
  /** FEATURE_033 fork 时由 host 传入；root session 不带。*/
  readonly parentSessionId?: string;
  readonly forkPointTurnIdx?: number;
  readonly emit: (event: SessionEvent) => void;
  /** 工具调用前的 gate；host 注入。Mock 用来模拟弹窗。*/
  readonly requestPermission: PermissionRequestFn;
};

/**
 * send() 的返回值 —— v0.1.4 起带 queue 路径信息。
 *   - { queued: false }                  立即起 run，走原来的事件流
 *   - { queued: true, queueId: '...' }   推到 KodaX SDK MessageQueue，下一轮 mid-turn drain 时消费
 */
export interface SendResult {
  readonly queued: boolean;
  readonly queueId?: string;
}

export interface ManagedSession {
  readonly sessionId: string;
  readonly projectRoot: string;
  /**
   * Provider / reasoningMode 在 F008 起可在 session 生命周期内切换
   * （session.setProvider / session.setReasoningMode IPC）——切换**不重启** session，
   * 仅影响下一条 prompt。实现侧只需简单赋值，下一次 send 时读最新值。
   */
  provider: string;
  reasoningMode: SessionCreateOptions['reasoningMode'];
  /** FEATURE_029: canonical 'plan' | 'accept-edits' | 'auto'。*/
  permissionMode: PermissionMode;
  /** 仅当 permissionMode === 'auto' 时有意义；缺省 'llm'。*/
  autoModeEngine: AutoModeEngine;
  /** AMA (默认 / 多 agent 协作) vs SA (单 agent，接口并发 fallback)。运行时可切。*/
  agentMode: AgentMode;
  /**
   * F045: 工作面归属（'code' = Coder / 'partner' = Partner）。创建时定死、不可变，
   * 持久化为 KodaX SDK session tag。决定 session 出现在哪个面的列表。
   */
  readonly surface: Surface;
  /**
   * SDK 0.7.42 setModel: model 覆盖 provider 默认；undefined = 用 provider 默认。
   * 切换不重启 session——下一次 send 时传入 runKodaX options.model。
   */
  model?: string;
  /**
   * SDK 0.7.42 setThinkingLevel 对齐：true / false 控制 thinking 输出；
   * undefined = 用 KodaX 默认。切换不重启 session——下一次 send 时传入 options.thinking。
   */
  thinking?: boolean;
  readonly createdAt: number;
  /** 最后一次发送 prompt / 收到事件的时间戳。`session.list` 用它排序。*/
  lastActivityAt: number;
  /**
   * 用户可读标题。
   *   - 创建时为 undefined
   *   - host 在第一次 send 时根据 prompt 头部 50 字自动填一个临时值
   *   - FEATURE_008 起再升级成 LLM 总结的 ≤ 8 字
   *   - 用户可通过 session.setTitle IPC 手工覆盖
   */
  title: string | undefined;

  /**
   * FEATURE_033 fork 元数据：仅 fork child 有；root session 不带。
   * KodaX SDK 0.7.42 持久化 API ready 后这两个字段会由 SDK 注入。
   */
  parentSessionId?: string;
  forkPointTurnIdx?: number;

  /**
   * Reviewer batch HIGH-3: true 表示有正在跑的 send (currentAbort != null)。
   * host.setPermissionMode 用此判断"切到 auto 时 guardrail bootstrap 是否会延迟到下一次 send"，
   * 并 emit 一条提示让用户知道当前这一轮不会立即受 AutoModeToolGuardrail 守。
   */
  isRunning(): boolean;

  /**
   * /compact slash command 设置的 flag。下一次 send 时 real-session 通过 contextTokenSnapshot
   * 把 currentTokens 顶到 999B,让 SDK auto-compaction 立即触发。consume 后必须清回 false。
   */
  compactRequested?: boolean;

  /**
   * 提交一条 prompt 到 session。**严格 fire-and-forget**：
   *
   *   - 实现**必须**在返回的 Promise resolve 前**只做同步建账**（如生成 turn id、
   *     入队 prompt、设置 AbortController）。任何 LLM 调用 / 工具子进程 spawn /
   *     磁盘写入都**必须**在 detached task 里跑，**不**在这个 Promise 内 await。
   *   - 调用方（IPC handler）会 await 这个 Promise——它代表"接受并已排入"，
   *     不代表"LLM 已开始流"或"已完成"。IPC 协议层 ACK 时间应当与 send() resolve
   *     时间一致（毫秒级，绝不秒级）。
   *
   * 并发约束：同一 session 在 send 进行中（即上一次 send 启动的事件流还没 emit
   * session_complete / session_error）不允许再 send——策略由实现选：
   *   - 排队  ：v0.1.4 起 Real adapter 把后续 prompt enqueue 到 SDK MessageQueue，
   *             返回 `{queued:true, queueId}`；KodaX mid-turn drain 会消费
   *   - 拒绝  ：throw，让 IPC handler 走 HANDLER_ERROR envelope（Mock 用这个）
   *
   * @throws 同步抛 / Promise reject：session 已 disposed、或拒绝并发
   */
  /**
   * OC-31 v0.1.9: `artifacts` 携带 user-inline image (clipboard paste / drag-drop).
   * 实现端把这些通过 KodaXOptions.context.inputArtifacts 传给 SDK；SDK 的
   * buildPromptMessageContent 会把每张 image 拼成 multimodal content block。
   * 未传时行为等同于"纯文本 prompt"，跟 v0.1.8 之前一致。
   */
  send(prompt: string, artifacts?: readonly InputArtifact[]): Promise<SendResult>;

  /**
   * 中断当前正在跑的 send。
   *   - 实现**必须**在中断时 emit 一条 `{ kind: 'session_error', error: 'cancelled' }`
   *     收尾（不是 session_complete）；renderer 用 kind 区分正常完成 vs 用户主动取消。
   *   - Real adapter 还**必须**确保所有派生 child process（bash 工具、grep、网络流）
   *     被 kill / 关闭——不允许"前台 abort 了但 LLM HTTP 流还在后台烧 token"。
   */
  cancel(): Promise<void>;

  /**
   * 释放 session 持有的所有资源。
   *   - dispose 后该 session 不应再被任何调用方使用（host 已从 Map 删除）。
   *   - 实现**必须**幂等：disposeAll 兜底 + 用户多次 delete 同一 session 都不应 throw。
   *   - Real adapter 还**必须**关闭 FileSessionStorage 句柄 / HTTP stream / abort 所有 in-flight。
   */
  dispose(): Promise<void>;
}

/** session 工厂函数签名，便于 KodaXHost 注入不同实现（Mock vs Real）。*/
export type SessionFactory = (opts: SessionCreateOptions) => ManagedSession;
