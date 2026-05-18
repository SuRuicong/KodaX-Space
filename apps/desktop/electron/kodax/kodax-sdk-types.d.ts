// Local ambient declarations for @kodax-ai/kodax/coding
//
// KodaX 0.7.40 SDK 的 dist .d.ts 写 `export * from '@kodax-ai/coding'`，但那个 sub-package
// 没单独发布到 npm（bundle 进了主包），导致 tsc 类型解析失败。运行时 JS 没问题——
// runKodaX 等函数真实存在于 dist/sdk-coding.js。
//
// Workaround：本地 ambient 声明用到的 minimal types。这是临时方案，等 KodaX SDK
// 修 type declarations bug 后删掉这个文件直接 import 真类型。

declare module '@kodax-ai/kodax/coding' {
  export type KodaXReasoningMode = 'off' | 'auto' | 'quick' | 'balanced' | 'deep';

  export interface KodaXTokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  }

  export interface KodaXEvents {
    onTextDelta?: (text: string) => void;
    onThinkingDelta?: (text: string) => void;
    onThinkingEnd?: (thinking: string) => void;
    onToolUseStart?: (tool: { name: string; id: string; input?: Record<string, unknown> }) => void;
    onToolResult?: (result: { id: string; name: string; content: string }) => void;
    onToolProgress?: (update: { id: string; message: string }) => void;
    onIterationStart?: (iter: number, maxIter: number) => void;
    onIterationEnd?: (info: {
      iter: number;
      maxIter: number;
      tokenCount: number;
      tokenSource?: 'api' | 'estimate';
      usage?: KodaXTokenUsage;
    }) => void;
    onStreamEnd?: () => void;
    onComplete?: () => void;
    onError?: (error: Error) => void;
  }

  export interface KodaXSessionOptions {
    id?: string;
  }

  export interface KodaXContextOptions {
    cwd?: string;
  }

  export interface KodaXOptions {
    provider: string;
    model?: string;
    reasoningMode?: KodaXReasoningMode;
    maxIter?: number;
    session?: KodaXSessionOptions;
    context?: KodaXContextOptions;
    events?: KodaXEvents;
    abortSignal?: AbortSignal;
  }

  export interface KodaXResult {
    text?: string;
    [key: string]: unknown;
  }

  export function runKodaX(options: KodaXOptions, prompt: string): Promise<KodaXResult>;
}
