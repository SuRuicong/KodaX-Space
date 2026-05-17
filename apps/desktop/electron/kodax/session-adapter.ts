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

import type { PermissionDecision, SessionEvent } from '@kodax-space/space-ipc-schema';

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
  readonly emit: (event: SessionEvent) => void;
  /** 工具调用前的 gate；host 注入。Mock 用来模拟弹窗。*/
  readonly requestPermission: PermissionRequestFn;
};

export interface ManagedSession {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly provider: string;
  readonly reasoningMode: SessionCreateOptions['reasoningMode'];
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
   *   - 排队  ：把后续 prompt 缓存，前一个流结束再启
   *   - 拒绝  ：throw，让 IPC handler 走 HANDLER_ERROR envelope（F003 Mock 用这个）
   *
   * @throws 同步抛 / Promise reject：session 已 disposed、或并发拒绝
   */
  send(prompt: string): Promise<void>;

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
