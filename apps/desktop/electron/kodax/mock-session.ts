// MockKodaXSession — F003 阶段不依赖真实 KodaX，先模拟一个 session 的事件流。
//
// 行为：
//   1. send(prompt) 启动一个 micro-task 序列：thinking_delta → text_delta x N → tool_start → tool_result
//      → iteration_end → session_complete
//   2. 每个 chunk 用 setTimeout 隔开几十毫秒，模拟真实流式
//   3. cancel() 通过 AbortSignal 中断 chunk 序列，emit session_error('cancelled')
//   4. 并发 send：第二次 send 在 in-flight 时直接 reject，不排队（F003 范围内的 send 已经一次跑完才会 ACK）

import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import type { ManagedSession, SessionCreateOptions } from './session-adapter.js';

const CHUNK_DELAY_MS = 35;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class MockKodaXSession implements ManagedSession {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly provider: string;
  readonly reasoningMode: ManagedSession['reasoningMode'];
  readonly createdAt: number;
  lastActivityAt: number;

  private readonly emit: (e: SessionEvent) => void;
  private currentAbort: AbortController | null = null;
  private disposed = false;

  constructor(opts: SessionCreateOptions) {
    this.sessionId = opts.sessionId;
    this.projectRoot = opts.projectRoot;
    this.provider = opts.provider;
    this.reasoningMode = opts.reasoningMode;
    this.createdAt = Date.now();
    this.lastActivityAt = this.createdAt;
    this.emit = opts.emit;
  }

  async send(prompt: string): Promise<void> {
    if (this.disposed) throw new Error(`[mock-session ${this.sessionId}] already disposed`);
    if (this.currentAbort) {
      throw new Error(`[mock-session ${this.sessionId}] previous send still in-flight`);
    }

    const abort = new AbortController();
    this.currentAbort = abort;
    this.lastActivityAt = Date.now();

    // fire-and-forget；调用方只关心 IPC 层面的 ACK
    void this.runMockStream(prompt, abort.signal).finally(() => {
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

  /** 模拟一次完整 run：thinking → 文本流 → 一次工具调用 → 迭代结束 → 完成。*/
  private async runMockStream(prompt: string, signal: AbortSignal): Promise<void> {
    const sid = this.sessionId;
    try {
      this.emit({ kind: 'thinking_delta', sessionId: sid, text: 'analysing prompt...' });
      await sleep(CHUNK_DELAY_MS, signal);

      const replyChunks = [
        '我收到了你的 prompt: ',
        `"${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}"`,
        '\n\n',
        '这是 FEATURE_003 阶段的 Mock 回应——',
        '验证 IPC 事件流从 main 到 renderer 完整跑通。',
      ];
      for (const text of replyChunks) {
        this.emit({ kind: 'text_delta', sessionId: sid, text });
        this.lastActivityAt = Date.now();
        await sleep(CHUNK_DELAY_MS, signal);
      }

      const toolId = `mock-tool-${Date.now().toString(36)}`;
      this.emit({
        kind: 'tool_start',
        sessionId: sid,
        toolId,
        toolName: 'read',
        input: { path: 'package.json' },
      });
      await sleep(CHUNK_DELAY_MS * 2, signal);

      this.emit({
        kind: 'tool_result',
        sessionId: sid,
        toolId,
        toolName: 'read',
        content: '{\n  "name": "kodax-space",\n  "version": "0.1.0-alpha.0"\n}',
      });
      await sleep(CHUNK_DELAY_MS, signal);

      this.emit({
        kind: 'iteration_end',
        sessionId: sid,
        iter: 1,
        maxIter: 30,
        tokenCount: 1280,
        usage: { inputTokens: 980, outputTokens: 300 },
      });
      await sleep(CHUNK_DELAY_MS, signal);

      this.emit({ kind: 'session_complete', sessionId: sid });
      this.lastActivityAt = Date.now();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.emit({ kind: 'session_error', sessionId: sid, error: 'cancelled' });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.emit({ kind: 'session_error', sessionId: sid, error: message });
      }
    }
  }
}
