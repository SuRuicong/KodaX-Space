// Local ambient declarations for @kodax-ai/kodax/coding
//
// KodaX 0.7.40 SDK 的 dist .d.ts 写 `export * from '@kodax-ai/coding'`，但那个 sub-package
// 没单独发布到 npm（bundle 进了主包），导致 tsc 类型解析失败。运行时 JS 没问题——
// runKodaX 等函数真实存在于 dist/sdk-coding.js。
//
// Workaround：本地 ambient 声明用到的 minimal types，对照 KodaX 源 packages/coding/src/types.ts 抽取
// （只列 Space 实际用得到的字段；不是完整 mirror）。这是临时方案，等 KodaX SDK
// 修 type declarations bug 后删掉这个文件直接 import 真类型。

declare module '@kodax-ai/kodax/coding' {
  export type KodaXReasoningMode = 'off' | 'auto' | 'quick' | 'balanced' | 'deep';
  export type KodaXAgentMode = 'ama' | 'sa';
  export type KodaXHarnessProfile = string;
  export type KodaXManagedTaskPhase = string;
  export type KodaXAmaFanoutClass = string;
  export type KodaXJsonValue =
    | string
    | number
    | boolean
    | null
    | KodaXJsonValue[]
    | { [key: string]: KodaXJsonValue };

  export interface KodaXTokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  }

  export interface KodaXContextTokenSnapshot {
    currentTokens: number;
    baselineEstimatedTokens: number;
    source: 'api' | 'estimate';
    usage?: KodaXTokenUsage;
  }

  // FEATURE_097 todo list — minimal shape Space consumes for Plan popout
  export interface KodaXTodoItem {
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm?: string;
  }
  export type KodaXTodoList = readonly KodaXTodoItem[];

  // ManagedLiveEvent / ManagedTaskStatusEvent — what onManagedTaskStatus emits
  export type KodaXManagedLiveEventPresentation = 'status' | 'assistant' | 'thinking';
  export interface KodaXManagedLiveEvent {
    key: string;
    kind: 'progress' | 'completed' | 'notification' | 'warning';
    presentation?: KodaXManagedLiveEventPresentation;
    phase?: KodaXManagedTaskPhase;
    workerId?: string;
    workerTitle?: string;
    summary: string;
    detail?: string;
    persistToHistory?: boolean;
  }

  export interface KodaXManagedTaskStatusEvent {
    agentMode: KodaXAgentMode;
    harnessProfile: KodaXHarnessProfile;
    activeWorkerId?: string;
    activeWorkerTitle?: string;
    childFanoutClass?: KodaXAmaFanoutClass;
    childFanoutCount?: number;
    currentRound?: number;
    maxRounds?: number;
    phase?: KodaXManagedTaskPhase;
    note?: string;
    detailNote?: string;
    events?: KodaXManagedLiveEvent[];
    persistToHistory?: boolean;
    upgradeCeiling?: KodaXHarnessProfile;
    globalWorkBudget?: number;
    budgetUsage?: number;
    budgetApprovalRequired?: boolean;
    idleWaiting?: boolean;
    idleWaitingPendingCount?: number;
  }

  // RepoIntelligence trace
  export type KodaXRepoIntelligenceMode =
    | 'auto'
    | 'off'
    | 'oss'
    | 'premium-shared'
    | 'premium-native';
  export interface KodaXRepoIntelligenceTraceEvent {
    kind: string;
    mode?: KodaXRepoIntelligenceMode;
    engine?: string;
    bridge?: string;
    status?: string;
    latencyMs?: number;
    cacheHit?: boolean;
    [key: string]: unknown;
  }

  // Retry-after structured payload
  export interface KodaXRetryAfterPayload {
    provider: string;
    waitMs: number;
    reason: 'rate-limit' | 'overloaded';
    source:
      | 'retry-after-seconds'
      | 'retry-after-date'
      | 'retry-after-ms'
      | 'exponential-backoff';
    attempt: number;
    maxAttempts: number;
  }

  // Provider recovery event (Feature 045) — minimal shape
  export interface KodaXProviderRecoveryEvent {
    stage: string;
    errorClass: string;
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    recoveryAction: string;
    ladderStep: number;
    fallbackUsed: boolean;
    serverRetryAfterMs?: number;
  }

  // Ask-user — KodaX defers user prompts to host UI
  export interface KodaXAskUserChoice {
    label: string;
    value: string;
    description?: string;
  }
  export interface KodaXAskUserQuestionOptions {
    question: string;
    choices?: readonly KodaXAskUserChoice[];
    allowFreeText?: boolean;
  }
  export interface KodaXAskUserMultiOptions {
    questions: ReadonlyArray<{
      id: string;
      question: string;
      choices?: readonly KodaXAskUserChoice[];
      allowFreeText?: boolean;
    }>;
  }

  export interface KodaXEvents {
    // 流式输出
    onTextDelta?: (text: string) => void;
    onThinkingDelta?: (text: string) => void;
    onThinkingEnd?: (thinking: string) => void;
    onToolUseStart?: (tool: { name: string; id: string; input?: Record<string, unknown> }) => void;
    onToolResult?: (result: { id: string; name: string; content: string }) => void;
    onToolProgress?: (update: { id: string; message: string }) => void;
    onToolInputDelta?: (
      toolName: string,
      partialJson: string,
      meta?: { toolId?: string },
    ) => void;
    onStreamEnd?: () => void;

    // 状态通知
    onSessionStart?: (info: { provider: string; sessionId: string }) => void;
    onIterationStart?: (iter: number, maxIter: number) => void;
    onIterationEnd?: (info: {
      iter: number;
      maxIter: number;
      tokenCount: number;
      tokenSource?: 'api' | 'estimate';
      usage?: KodaXTokenUsage;
      contextTokenSnapshot?: KodaXContextTokenSnapshot;
      scope?: 'parent' | 'worker';
    }) => void;

    // Compaction
    onCompactStart?: () => void;
    onCompact?: (estimatedTokens: number) => void;
    onCompactStats?: (info: { tokensBefore: number; tokensAfter: number }) => void;
    onCompactEnd?: () => void;

    onMidTurnUserMessages?: (contents: readonly string[]) => void;
    onRetry?: (reason: string, attempt: number, maxAttempts: number) => void;
    onProviderRateLimit?: (attempt: number, maxRetries: number, delayMs: number) => void;
    onRetryAfter?: (payload: KodaXRetryAfterPayload) => void;
    onRepoIntelligenceTrace?: (event: KodaXRepoIntelligenceTraceEvent) => void;
    onTodoUpdate?: (items: KodaXTodoList) => void;
    onProviderRecovery?: (event: KodaXProviderRecoveryEvent) => void;
    onComplete?: () => void;
    onError?: (error: Error) => void;
    onManagedTaskStatus?: (status: KodaXManagedTaskStatusEvent) => void;
    onScoutSuspiciousCompletion?: (payload: {
      confidence: 'uncertain';
      signals: readonly string[];
      sessionId?: string;
      lastTextPreview: string;
    }) => void;

    /** Agent fills in current at session start. Host calls .current() for formatted cost. */
    getCostReport?: { current: (() => string) | null };

    // 用户交互（host 端实现 modal）
    /** 工具执行前回调 — return false to block, return string to override tool result, return true to proceed. */
    beforeToolExecute?: (
      tool: string,
      input: Record<string, unknown>,
      meta?: { toolId?: string },
    ) => Promise<boolean | string>;
    askUser?: (options: KodaXAskUserQuestionOptions) => Promise<string>;
    askUserMulti?: (
      options: KodaXAskUserMultiOptions,
    ) => Promise<Record<string, string> | undefined>;
    askUserInput?: (options: {
      question: string;
      default?: string;
    }) => Promise<string | undefined>;
    /** Plan-mode exit — host approves the plan, returns true/false. */
    exitPlanMode?: (plan: string) => Promise<boolean | 'not-in-plan-mode'>;
  }

  export interface KodaXSessionOptions {
    id?: string;
    resume?: boolean;
    autoResume?: boolean;
  }

  export interface KodaXContextOptions {
    /** Project root for project-scoped prompts, permissions, path policy. Falls back to cwd. */
    gitRoot?: string | null;
    /** Explicit working directory for prompts / relative paths / shell exec. */
    executionCwd?: string;
    /** Best-known token snapshot for context size tracking. */
    contextTokenSnapshot?: KodaXContextTokenSnapshot;
    repoIntelligenceMode?: KodaXRepoIntelligenceMode;
    repoIntelligenceTrace?: boolean;
    /**
     * FEATURE_074: Plan-mode block predicate. Host supplies; returns reason string when the
     * tool call should be blocked (plan-mode write tool), null when allowed.
     * Closes over live mode state so mid-run toggles propagate.
     */
    planModeBlockCheck?: (tool: string, input: Record<string, unknown>) => string | null;
    /** cwd alias for backward compat with prior Space code. */
    cwd?: string;
  }

  export interface KodaXOptions {
    provider: string;
    model?: string;
    modelOverride?: string;
    thinking?: boolean;
    reasoningMode?: KodaXReasoningMode;
    agentMode?: KodaXAgentMode;
    maxIter?: number;
    session?: KodaXSessionOptions;
    context?: KodaXContextOptions;
    events?: KodaXEvents;
    /** FEATURE_092: run-scoped guardrails forwarded to Runner.run. AutoMode 注入点。*/
    guardrails?: readonly Guardrail[];
    abortSignal?: AbortSignal;
  }

  export interface KodaXResult {
    text?: string;
    [key: string]: unknown;
  }

  export function runKodaX(options: KodaXOptions, prompt: string): Promise<KodaXResult>;

  // ============= FEATURE_030 AutoModeToolGuardrail surface =============
  // Minimal subset of @kodax-ai/coding 暴露的 guardrail / agents-loader 类型，
  // 供 Space main 端 wire FEATURE_030 时用。完整 surface 见 KodaX
  // packages/coding/src/guardrails/auto-mode/guardrail.ts。

  /** AGENTS.md scan result item. 与 Space agents-md-loader.ts 严格 shape 对齐。*/
  export interface AgentsFile {
    path: string;
    content: string;
    scope: 'global' | 'project' | 'directory';
  }

  /** AutoMode classifier engine. */
  export type AutoModeEngineKodaX = 'llm' | 'rules';

  /** 用户响应 (FEATURE_092 phase 2b.7b)。*/
  export type AutoModeAskUserVerdict = 'allow' | 'block';

  /** 静态分析信号 (FEATURE_158)。本 type 不完整 mirror — 只暴露 Space adapter 用到的字段。*/
  export interface ToolCallSignal {
    type: string;
    severity?: string;
    message?: string;
    [key: string]: unknown;
  }

  /** Tool call snapshot fed to AutoModeAskUser. */
  export interface RunnerToolCall {
    name: string;
    input: Record<string, unknown>;
    id?: string;
    [key: string]: unknown;
  }

  export type AutoModeAskUser = (
    call: RunnerToolCall,
    reason: string,
    signals?: readonly ToolCallSignal[],
  ) => Promise<AutoModeAskUserVerdict>;

  export interface KodaXBaseProvider {
    [key: string]: unknown;
  }

  /**
   * Guardrail 接口（minimal）。KodaXOptions.guardrails 数组项形态。
   * AutoModeToolGuardrail 实现该接口；KodaX runtime 通过 beforeTool / 其他钩子
   * 调进来。Space 不实例化通用 Guardrail，只用 createAutoModeToolGuardrail 产物。
   */
  export interface Guardrail {
    readonly name: string;
    readonly beforeTool?: unknown;
    readonly beforeInput?: unknown;
    readonly afterOutput?: unknown;
  }

  /** AutoMode engine 变更回调（manual / fallback）。 */
  export type AutoModeOnEngineChange = (engine: AutoModeEngineKodaX) => void;

  /** AutoRules loader 输出（loadAutoRules 返回）。Space 只读 sources / errors 给 banner 用。*/
  export interface AutoRules {
    [key: string]: unknown;
  }
  export interface RulesLoadResult {
    merged: AutoRules;
    sources: readonly string[];
    errors: readonly string[];
    skipped?: readonly string[];
  }

  /** SignalCollector — 静态分析 signal 产出器；不在 Space 端实现，仅占位类型。*/
  export interface SignalCollector {
    [key: string]: unknown;
  }

  /** createAutoModeToolGuardrail 完整 config（subset；只列 Space 用得到的）。 */
  export interface AutoModeGuardrailConfig {
    readonly rules: AutoRules;
    readonly claudeMd?: string;
    readonly askUser?: AutoModeAskUser;
    readonly getToolProjection: (toolName: string) => ((input: unknown) => string) | undefined;
    readonly resolveProvider: (providerName: string) => KodaXBaseProvider | undefined;
    readonly defaultProvider: string;
    readonly defaultModel: string;
    readonly getDefaultProvider?: () => string;
    readonly getDefaultModel?: () => string;
    readonly log?: (level: 'info' | 'warn', msg: string) => void;
    readonly onEngineChange?: AutoModeOnEngineChange;
    readonly initialEngine?: AutoModeEngineKodaX;
    readonly timeoutMs?: number;
    readonly userSettings?: string;
    readonly envVar?: string;
    readonly projectRoot?: string;
    readonly extraCollectors?: readonly SignalCollector[];
  }

  export interface AutoModeToolGuardrail extends Guardrail {
    getEngine(): AutoModeEngineKodaX;
    setEngine(engine: AutoModeEngineKodaX): void;
  }

  export function createAutoModeToolGuardrail(
    config: AutoModeGuardrailConfig,
  ): AutoModeToolGuardrail;

  export interface LoadAutoRulesOptions {
    userKodaxDir?: string;
    projectRoot?: string;
  }
  export function loadAutoRules(options: LoadAutoRulesOptions): Promise<RulesLoadResult>;

  export function formatAgentsForPrompt(files: readonly AgentsFile[]): string;
  export function getKodaxGlobalDir(): string;
  export function resolveProvider(name: string): KodaXBaseProvider;
  export function getRegisteredToolDefinition(
    toolName: string,
  ): { toClassifierInput?: (input: unknown) => string } | undefined;
  export function getBuiltinRegisteredToolDefinition(
    toolName: string,
  ): { toClassifierInput?: (input: unknown) => string } | undefined;
}
