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

import type { SessionEvent } from '@kodax-space/space-ipc-schema';

export type SessionCreateOptions = {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly provider: string;
  readonly reasoningMode: 'off' | 'auto' | 'quick' | 'balanced' | 'deep';
  readonly emit: (event: SessionEvent) => void;
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
   * 提交一条 prompt 到 session。立即返回（fire-and-forget）；进度由 emit() 推。
   * 并发约束：同一 session 在 send 进行中不允许再 send——具体策略由实现决定
   * （可以排队、可以拒绝；F003 Mock 实现直接拒绝）。
   */
  send(prompt: string): Promise<void>;

  /** 中断当前正在跑的 send。已发送 prompt 的部分输出按 send_error 收尾。*/
  cancel(): Promise<void>;

  /** 释放 session 持有的资源（abortSignal、临时文件等）。dispose 后不应再被使用。*/
  dispose(): Promise<void>;
}

/** session 工厂函数签名，便于 KodaXHost 注入不同实现（Mock vs Real）。*/
export type SessionFactory = (opts: SessionCreateOptions) => ManagedSession;
