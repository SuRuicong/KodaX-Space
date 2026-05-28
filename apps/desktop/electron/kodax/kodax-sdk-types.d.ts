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

  export type KodaXSessionScope = 'user' | 'managed-task-worker';

  /**
   * SDK 暴露的 storage handle（FileSessionStorage 实例）。Space 通过
   * createSessionManager().storage 拿到，传入 KodaXOptions.session.storage 让 SDK
   * 真正落盘 — 不传则 saveSessionSnapshot 静默 no-op，jsonl 不写。
   *
   * 这里用 unknown 不做结构约束（具体方法在 sdk-session.d.ts 里），让 caller 直接透传。
   */
  export type KodaXSessionStorageHandle = unknown;

  export interface KodaXSessionOptions {
    id?: string;
    resume?: boolean;
    autoResume?: boolean;
    /** 'user' = sidebar 主对话（默认）；'managed-task-worker' = 子 agent 内部 session（不入主列表） */
    scope?: KodaXSessionScope;
    /** FileSessionStorage 实例。caller 用 createSessionManager().storage 拿。 */
    storage?: KodaXSessionStorageHandle;
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

  /**
   * v0.7.42 SDK 出口 — 加载 AGENTS.md 文件，按优先级 global < root < ... < cwd < .kodax/。
   * 比 Space 自己写的"只扫 projectRoot + global" loader 行为更完整（递归向上扫）。
   * 同步实现（SDK 内部为 hot path，sync I/O 但快）。
   */
  export interface LoadAgentsOptions {
    cwd?: string;
    kodaxDir?: string;
    projectRoot?: string;
  }
  export function loadAgentsFiles(options?: LoadAgentsOptions): AgentsFile[];
  export function resolveProvider(name: string): KodaXBaseProvider;
  export function getRegisteredToolDefinition(
    toolName: string,
  ): { toClassifierInput?: (input: unknown) => string } | undefined;
  export function getBuiltinRegisteredToolDefinition(
    toolName: string,
  ): { toClassifierInput?: (input: unknown) => string } | undefined;

  /**
   * v0.7.42 — plan-mode permit check driven by tool metadata.
   *   - `sideEffect === 'readonly'` ⇒ allowed (unless `planModeAllowed: false`)
   *   - `planModeAllowed: true` ⇒ allowed (overrides non-readonly)
   *   - any other sideEffect ⇒ blocked
   *   - unknown tool name ⇒ false (fail-closed)
   *
   * 替换之前 Space 端 hardcoded `Set<string>` blocklist——新增 'mutates-fs' tool 自动流过。
   */
  export function isToolPlanModeAllowed(name: string): boolean;

  // ============= FEATURE_197 (v0.7.43) markdown agent discovery =============
  //
  // 只读 / 零 admission / 零 registry mutation 的 markdown agent metadata 列表。
  // Space 端用它给 UI 做 agent picker——loadAgentsFromMarkdown 仍然在 KodaX session
  // 启动期自动跑一遍（admission + registration），discoverMarkdownAgents 只用于
  // "在 picker 里告诉用户哪些 agent 文件存在 / 哪些坏掉了"。

  export interface LoadAgentsFromMarkdownOptions {
    /** 项目根。项目 agents 在 `${cwd}/.kodax/agents/*.md`。缺省 = 当前工作目录。*/
    readonly cwd?: string;
    /** 用户配置目录。用户 agents 在 `${configHome}/agents/*.md`。缺省 = `~/.kodax`。*/
    readonly configHome?: string;
  }

  export interface MarkdownLoadFailure {
    readonly path: string;
    readonly reason: string;
  }

  export interface DiscoveredMarkdownAgent {
    readonly name: string;
    readonly description: string;
    /** Provenance: 'markdown:user' = ~/.kodax/agents；'markdown:project' = <cwd>/.kodax/agents. */
    readonly source: 'markdown:user' | 'markdown:project';
    /** 源文件绝对路径——给 UI 做 "open file in OS" affordance 用。*/
    readonly path: string;
    /** frontmatter `tools` 字段；SDK 在内部 admission 时给 ToolRef 加 `builtin:` 前缀，
     *  这里返回的是用户写的原始名字（不带前缀）。 */
    readonly tools?: readonly string[];
    /** frontmatter `model` 字段，可选 alias。 */
    readonly model?: string;
  }

  export interface DiscoverMarkdownAgentsResult {
    /** 通过 frontmatter 校验的 agent metadata。Last-write-wins：项目同名 shadow 用户。*/
    readonly agents: readonly DiscoveredMarkdownAgent[];
    /** frontmatter 存在但校验失败的文件（坏 yaml / 空 description / 空 body / I/O 错）。*/
    readonly failed: readonly MarkdownLoadFailure[];
  }

  /**
   * v0.7.43 FEATURE_197 — 纯只读 markdown agent 发现。不调 Runner.admit、不写 registry。
   * Space 端 UI picker 调用它列可用 agent；KodaX session 启动期会另外跑一次
   * loadAgentsFromMarkdown 真正激活——validation 语义两边对齐。
   */
  export function discoverMarkdownAgents(
    opts?: LoadAgentsFromMarkdownOptions,
  ): Promise<DiscoverMarkdownAgentsResult>;
}

// ============= @kodax-ai/kodax/agent — context window resolver =============
//
// Space main 端用 resolveContextWindow 替代硬编码 modelContextCaps.ts。SDK 已经在
// runtime 用同样的级联（compactionConfig.contextWindow → provider.getEffectiveContextWindow
// → provider.getContextWindow → 200_000）决定真正的 compaction trigger；UI 显示用同一
// 算法是 single source of truth 的硬性要求 — 否则用户看到的窗口和 SDK 实际触发 compaction
// 的窗口会错位。
//
// 这里只暴露 Space 用到的 surface（resolveContextWindow + 必需 type 别名）。完整 sdk-agent
// 表面非常大，等 SDK fix 主 .d.ts 后整体删掉本地 ambient。
declare module '@kodax-ai/kodax/agent' {
  import type { KodaXBaseProvider } from '@kodax-ai/kodax/coding';

  /** Minimum subset of CompactionConfig that resolveContextWindow reads.
   *  完整 shape 见 SDK types-chunks/types.d-CKJtjo-6.d.ts:1049. */
  export interface CompactionConfig {
    enabled: boolean;
    triggerPercent: number;
    /** 用户 override；resolveContextWindow 级联第一步。*/
    contextWindow?: number;
    /** 其余字段（keepRecentPercent / protectionPercent / ...）resolveContextWindow 不用到，省略。*/
    [key: string]: unknown;
  }

  /** Hard fallback 值 — SDK 也 export 这个常量。*/
  export const DEFAULT_CONTEXT_WINDOW: 200000;

  /**
   * 四步级联 resolve effective context window：
   *   1. compactionConfig.contextWindow (user override) →
   *   2. provider.getEffectiveContextWindow?.(modelOverride) →
   *   3. provider.getContextWindow?.() →
   *   4. DEFAULT_CONTEXT_WINDOW (200_000)
   */
  export function resolveContextWindow(
    compactionConfig: CompactionConfig,
    provider: KodaXBaseProvider,
    modelOverride: string | undefined,
  ): number;
}

// ============= FEATURE_035 @kodax-ai/kodax/skills =============
//
// 同 coding 子包：SDK 内部走 `export * from '@kodax-ai/skills'` 但 @kodax-ai/skills
// 不是直接 npm 依赖（@kodax-ai/kodax bundled 时把 skills 代码打进 chunks/）。
// 这里 minimal 声明 Space main 端用到的 surface。
declare module '@kodax-ai/kodax/skills' {
  /**
   * Skill 来源。
   *   user      — ~/.kodax/skills/
   *   project   — ${projectRoot}/.kodax/skills/
   *   plugin    — KodaX plugin 注册的 skill
   *   builtin   — KodaX 内置 skill（git-workflow / code-review / skill-creator 等）
   */
  export type SkillSource = 'user' | 'project' | 'plugin' | 'builtin';

  /** 轻量 metadata，由 loadSkillMetadata / discoverSkills 返回。 */
  export interface SkillMetadata {
    readonly name: string;
    readonly description: string;
    readonly userInvocable: boolean;
    readonly argumentHint?: string;
    readonly path: string;
    readonly source: SkillSource;
    readonly disableModelInvocation: boolean;
  }

  /**
   * VariableResolver context — Space 端 wire 时填 sessionId / cwd / env。
   * SDK 内部用 ${VAR}, $1..$N, $ARGUMENTS, !`cmd` 等 token 解析。
   */
  export interface VariableContext {
    readonly sessionId: string;
    readonly workingDirectory: string;
    readonly environment: Record<string, string>;
  }

  /** Skill invoke 结果（SDK SkillRegistry.invoke 返回）。 */
  export interface SkillInvokeResult {
    readonly success: boolean;
    readonly content: string;
    readonly error?: string;
  }

  /** Discover 输出 (discoverSkills) 。 */
  export interface DiscoverSkillsResult {
    readonly skills: ReadonlyMap<string, SkillMetadata>;
    readonly errors: ReadonlyArray<{ path: string; error: string }>;
  }

  export interface DiscoverSkillsOptions {
    readonly projectPaths?: readonly string[];
    readonly userPaths?: readonly string[];
    readonly builtinPaths?: readonly string[];
  }

  export function discoverSkills(
    projectRoot: string,
    options?: DiscoverSkillsOptions,
  ): Promise<DiscoverSkillsResult>;

  /**
   * Full skill 体（loadFull 返回；SkillRegistry.loadFull 也用）。
   * Space wrapper 用 content/rawContent 做 unsafe-token 预扫；不依赖 scripts/references 字段。
   */
  export interface LoadedSkill extends SkillMetadata {
    readonly content: string;
    readonly rawContent: string;
    readonly skillFilePath: string;
    readonly loaded: true;
  }

  /**
   * SkillRegistry — Space 用这个高层 API 而不是直接调 discoverSkills / loadFullSkill。
   * 每个 projectRoot 一个实例（路径不同 → 不同 skill 集合）。
   */
  export class SkillRegistry {
    constructor(projectRoot: string, customPaths?: DiscoverSkillsOptions);
    discover(): Promise<void>;
    get(name: string): SkillMetadata | undefined;
    list(): readonly SkillMetadata[];
    listUserInvocable(): readonly SkillMetadata[];
    /** 拿完整 skill 体（含 markdown content）。Space wrapper 用来做 unsafe-token scrub。*/
    loadFull(name: string): Promise<LoadedSkill>;
    invoke(
      name: string,
      argumentsString: string,
      context: VariableContext,
    ): Promise<SkillInvokeResult>;
    reload(): Promise<void>;
  }
}
