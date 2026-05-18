// RealKodaXSession — F011-real (alpha.2)
//
// 实接 @kodax-ai/kodax 内核，替代 Mock。镜像 ManagedSession 接口，跟 Mock 同 shape
// （host.ts 用同一 factory 协议）。所有 KodaX 事件通过 KodaXEvents 回调映射到
// SessionEvent push schema。
//
// 设计点：
//   1. **send() 同步建账**：spawn 个 detached task 跑 runKodaX；send Promise 立刻 resolve
//      "已排进 session"，与 Mock 同款 fire-and-forget 语义
//   2. **AbortController 串到 KodaX**：cancel() 触发 abort → KodaX runtime 收到信号停 LLM 流 + tool spawn
//   3. **并发约束**：同 session in-flight 时再 send 直接 throw，跟 Mock 一致
//   4. **provider 读 env**：KodaX 自己读 ZHIPU_API_KEY / KIMI_API_KEY / ARK_API_KEY 等用户已配的 env vars，
//      Space 不再二次注入（Space 的 keychain 配置可选，env vars 优先）
//   5. **permission gate 暂走 Space broker**：alpha.2 阶段先用 Space 的 PermissionBroker
//      （session-adapter PermissionRequestFn）。KodaX runtime 自己也有 permission，
//      下一波再合并双 broker（alpha.3）。当前 RealKodaXSession 不主动调 requestPermission——
//      KodaX 内部走默认 'auto' permissionMode 让所有 tool 跑

import { runKodaX } from '@kodax-ai/kodax/coding';
import type { KodaXOptions, KodaXEvents } from '@kodax-ai/kodax/coding';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import type {
  ManagedSession,
  PermissionRequestFn,
  SessionCreateOptions,
} from './session-adapter.js';

// KodaX reasoningMode 映射 — Space schema 是 'off'/'auto'/'quick'/'balanced'/'deep'，
// KodaX SDK 是同样的字符串集（直接复制 KodaXReasoningMode 闭集）
type SpaceReasoning = 'off' | 'auto' | 'quick' | 'balanced' | 'deep';

export class RealKodaXSession implements ManagedSession {
  readonly sessionId: string;
  readonly projectRoot: string;
  provider: string;
  reasoningMode: SpaceReasoning;
  permissionMode: ManagedSession['permissionMode'];
  readonly createdAt: number;
  lastActivityAt: number;
  title: string | undefined = undefined;

  private readonly emit: (e: SessionEvent) => void;
  // 暂未启用：alpha.2 走 KodaX 内置 permission，下波合并到 Space broker。
  // 字段保留供 ManagedSession 接口完整 + 后续 wire。
  // @ts-expect-error wired to permission broker in alpha.3
  private readonly requestPermission: PermissionRequestFn;
  private currentAbort: AbortController | null = null;
  private disposed = false;

  constructor(opts: SessionCreateOptions) {
    this.sessionId = opts.sessionId;
    this.projectRoot = opts.projectRoot;
    this.provider = opts.provider;
    this.reasoningMode = opts.reasoningMode;
    this.permissionMode = opts.permissionMode;
    this.createdAt = Date.now();
    this.lastActivityAt = this.createdAt;
    this.emit = opts.emit;
    this.requestPermission = opts.requestPermission;
  }

  async send(prompt: string): Promise<void> {
    if (this.disposed) {
      throw new Error(`[real-session ${this.sessionId}] already disposed`);
    }
    if (this.currentAbort) {
      throw new Error(`[real-session ${this.sessionId}] previous send still in-flight`);
    }

    const abort = new AbortController();
    this.currentAbort = abort;
    this.lastActivityAt = Date.now();

    // fire-and-forget — KodaXOptions.abortSignal 串到 KodaX runtime
    void this.runRealStream(prompt, abort.signal).finally(() => {
      if (this.currentAbort === abort) this.currentAbort = null;
    });
  }

  async cancel(): Promise<void> {
    if (this.currentAbort) {
      this.currentAbort.abort();
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.currentAbort) this.currentAbort.abort();
  }

  /**
   * 真实跑 KodaX 一次。把 KodaXEvents 映射到 SessionEvent push。
   *
   * Events 映射（看 packages/coding/src/types.ts KodaXEvents）：
   *   onTextDelta(text)                              → text_delta
   *   onThinkingDelta(text)                          → thinking_delta
   *   onToolUseStart({name, id, input})              → tool_start
   *   onToolResult({id, name, content})              → tool_result
   *   onToolProgress({id, message})                  → tool_progress
   *   onIterationEnd({iter, maxIter, tokenCount, usage}) → iteration_end
   *   onComplete()                                   → session_complete
   *   onError(err)                                   → session_error
   */
  private async runRealStream(prompt: string, signal: AbortSignal): Promise<void> {
    const sid = this.sessionId;

    const events: KodaXEvents = {
      onTextDelta: (text) => {
        this.lastActivityAt = Date.now();
        this.emit({ kind: 'text_delta', sessionId: sid, text });
      },
      onThinkingDelta: (text) => {
        this.emit({ kind: 'thinking_delta', sessionId: sid, text });
      },
      onToolUseStart: (tool) => {
        this.emit({
          kind: 'tool_start',
          sessionId: sid,
          toolId: tool.id,
          toolName: tool.name,
          input: tool.input,
        });
      },
      onToolResult: (result) => {
        this.emit({
          kind: 'tool_result',
          sessionId: sid,
          toolId: result.id,
          toolName: result.name,
          content: result.content,
        });
      },
      onToolProgress: (update) => {
        this.emit({
          kind: 'tool_progress',
          sessionId: sid,
          toolId: update.id,
          message: update.message,
        });
      },
      onIterationEnd: (info) => {
        this.emit({
          kind: 'iteration_end',
          sessionId: sid,
          iter: info.iter,
          maxIter: info.maxIter,
          tokenCount: info.tokenCount,
          usage: info.usage
            ? {
                inputTokens: info.usage.inputTokens,
                outputTokens: info.usage.outputTokens,
                cacheReadInputTokens: info.usage.cacheReadInputTokens,
                cacheWriteInputTokens: info.usage.cacheCreationInputTokens,
              }
            : undefined,
        });
      },
      onComplete: () => {
        this.emit({ kind: 'session_complete', sessionId: sid });
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.emit({ kind: 'session_error', sessionId: sid, error: message });
      },
    };

    const options: KodaXOptions = {
      provider: this.provider,
      reasoningMode: this.reasoningMode,
      events,
      abortSignal: signal,
      session: {
        // KodaX session storage 落在 ~/.kodax/sessions/，session id 用 Space 给的
        // KodaX 会自己持久化对话历史，下一条 prompt 续上
        id: sid,
      },
      context: {
        // 工作目录就是 Space 的 projectRoot
        cwd: this.projectRoot,
      },
    };

    try {
      await runKodaX(options, prompt);
    } catch (err) {
      // abort 走 onError 之外的最后兜底——AbortError 也算正常 cancel 路径
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.emit({ kind: 'session_error', sessionId: sid, error: 'cancelled' });
      } else if (!signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit({ kind: 'session_error', sessionId: sid, error: message });
      }
    }
  }
}
