// RealKodaXSession — F011-real / alpha.1 KodaX 0.7.40 full surface
//
// 实接 @kodax-ai/kodax 内核。镜像 ManagedSession 接口。Mock 与 Real 同 shape。
//
// alpha.1 vs alpha.2:
//   - alpha.2 只接了基础对话回路 (text/thinking/tool*/iteration_end/complete/error/cancel)
//   - alpha.1 (此版) 把 KodaX 0.7.40 暴露的全部钩子接上——permission/plan-mode/exit-plan-mode/
//     todo/managed-task-status/compaction/retry/repointel/session-start/iteration-start/
//     stream-end/thinking-end/tool-input-delta/provider-recovery
//
// 关键架构：Permission 统一指向 Space。
//   ❌ 旧方案"双 broker"：KodaX 内部一套 + Space 一套
//   ✅ 现方案：KodaX 暴露 events.beforeToolExecute 钩子 → 转 Space PermissionBroker
//      → broker 据 session.permissionMode 短路或弹 modal → 决策回流 KodaX
//      KodaX 看到 false 就跳过工具，看到 true 就执行。
//      Plan-mode 由 context.planModeBlockCheck 把 write 工具拦在 KodaX 入口处。
//      Exit plan mode 由 events.exitPlanMode 让 Space 弹 modal（v0.1.x 中先 stub allow）。

// **静态 import 改 dynamic**：SDK subpath exports 只有 "import" 条件，CJS main require 会撞
// ERR_PACKAGE_PATH_NOT_EXPORTED。下面用 lazy load + cache，type-only 用 type import 不产生 runtime require。
type SdkCodingModule = typeof import('@kodax-ai/kodax/coding');
let sdkCodingCache: SdkCodingModule | null = null;
async function loadSdkCoding(): Promise<SdkCodingModule> {
  if (sdkCodingCache === null) {
    sdkCodingCache = await import('@kodax-ai/kodax/coding');
  }
  return sdkCodingCache;
}

// OC-23: SDK /llm 暴露 extractHeadersFromError + parseRetryAfter 帮我们从 rate_limit
// 错误里抠出 Retry-After header 的等待时间 (Anthropic 还有 retry-after-ms 扩展)。
// 单独 lazy-load /llm 子包；失败时返 null 不影响主错误流程。
//
// 缓存 **Promise** 而非 resolved value —— 并发调下两个 caller 各自 import() 是 Node
// module registry 安全的（去重），但本地缓存的赋值时机需要并发安全。存 Promise 让所有
// 并发 caller await 同一个 in-flight promise，避免多次 try 且行为确定 (review HIGH-1)。
type SdkLlmModule = typeof import('@kodax-ai/kodax/llm');
let sdkLlmCache: Promise<SdkLlmModule | null> | null = null;
function loadSdkLlm(): Promise<SdkLlmModule | null> {
  if (sdkLlmCache === null) {
    sdkLlmCache = import('@kodax-ai/kodax/llm').catch((err) => {
      console.warn(`[real-session] failed to load @kodax-ai/kodax/llm subpath: ${err instanceof Error ? err.message : err}`);
      // 失败的 promise 留在 cache 里返 null，避免反复重试一个本来就拿不到的包。
      // 如果 SDK 之后真"突然能加载了"也无所谓 —— Space 进程整生命周期 SDK 是 immutable。
      return null;
    });
  }
  return sdkLlmCache;
}

/**
 * 从 SDK 抛出的 error 里抠 Retry-After（rate_limit / 5xx 时有）。
 * SDK /llm 加载失败 / err 里没 header → undefined。返 'header' type 的 waitMs；
 * 'backoff' fallback 类型不当做服务器明确建议，返 undefined。
 */
async function extractRetryAfterMs(err: unknown): Promise<number | undefined> {
  const llm = await loadSdkLlm();
  if (llm === null) return undefined;
  try {
    const headers = llm.extractHeadersFromError(err);
    if (headers === undefined) return undefined;
    // attempt=0 是 ParseRetryAfterOptions 必填 — backoff fallback 才用，我们只关心 header branch
    const result = llm.parseRetryAfter(headers, { attempt: 0 });
    if (result.type === 'header') return result.waitMs;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * v0.1.4 review MED-1：sanitize auto-mode bootstrap 失败的错误文本再放进
 * auto_engine_change.details（最终展示在 NotificationsSurface）。
 * - strip 绝对路径段：Windows 盘符（大/小写）/ UNC / POSIX
 * - 截到 240 字符给 details 的 wrapper 文案留余地（schema 上限 512）
 * 复用 updater.ts 同款 union regex；rawMessage 仍进 console.warn。
 */
function sanitizeAutoModeErrorMessage(msg: string): string {
  return msg
    .replace(/([A-Za-z]:[\\/][^\s]+|\\\\[^\s]+|\/[A-Za-z][^\s]+)/g, '<path>')
    .slice(0, 240)
    .trim() || 'unknown error';
}

import type {
  AutoModeAskUser,
  AutoModeAskUserVerdict,
  AutoModeEngine,
  Guardrail,
  KodaXOptions,
  KodaXEvents,
  KodaXSessionStorage,
  ToolCallSignal,
} from '@kodax-ai/kodax/coding';
import type { InputArtifact, SessionEvent, Surface } from '@kodax-space/space-ipc-schema';
import { askUserBroker } from '../permission/ask-user-broker.js';
import { bootstrapAutoMode } from './auto-mode-bootstrap.js';
import { getSessionStorageHandle } from './session-store.js';
import { wrapSdkError } from './sdk-errors.js';
import { buildSkillsPrompt } from './skills-prompt.js';
import { SPACE_MANUAL_TOPICS, SPACE_PRODUCT_NAME } from './space-manual-topics.js';
import type {
  ManagedSession,
  PermissionRequestFn,
  SendResult,
  SessionCreateOptions,
} from './session-adapter.js';
import { enqueueUserPrompt, drainQueueForSession } from '../ipc/queue.js';

type SpaceReasoning = 'off' | 'auto' | 'quick' | 'balanced' | 'deep';

// Plan-mode 工具拦截：v0.7.42 切到 SDK `isToolPlanModeAllowed`，基于工具注册时的
// `sideEffect` / `planModeAllowed` 元数据自动判定——SDK 新增 'mutates-fs' 工具
// 自动流过，Space 不再硬编码 Set。fail-closed：未知 tool 一律 block。
//
// 之前 v0.1.1~v0.1.5 维护过一个 20+ tool 名 hardcoded Set（每次 KodaX 升 SDK
// 都要 review 漏没漏新工具）；v0.1.6 升 SDK 0.7.42 时切到本路径（cleanup gap）。

export class RealKodaXSession implements ManagedSession {
  readonly sessionId: string;
  readonly projectRoot: string;
  provider: string;
  reasoningMode: SpaceReasoning;
  permissionMode: ManagedSession['permissionMode'];
  /** FEATURE_029：auto mode 子档；非 auto mode 时持有也无害（下次切 auto 时生效）。*/
  autoModeEngine: ManagedSession['autoModeEngine'];
  /** AMA (默认 / 多智能体协作) vs SA (单 agent，接口并发受限时降级)。*/
  agentMode: ManagedSession['agentMode'];
  /**
   * F045: 工作面归属（'code' = Coder / 'partner' = Partner）。session 创建时定死，
   * 持久化为 KodaX SDK session tag（写盘时把该值原样写进 session.tag）。
   * 决定它出现在哪个面的列表，并将来驱动工具集裁剪（F047）。
   */
  readonly surface: Surface;
  /** SDK 0.7.42 wired: 用户 /model 设的覆盖；undefined 走 provider 默认。*/
  model?: string;
  /** SDK 0.7.42 wired: 用户 /thinking 设的开关；undefined 走 KodaX 默认。*/
  thinking?: boolean;
  readonly createdAt: number;
  lastActivityAt: number;
  title: string | undefined = undefined;
  /** FEATURE_033 fork 元数据；root session 都为 undefined。*/
  parentSessionId?: string;
  forkPointTurnIdx?: number;
  /** /compact one-shot flag (见 ManagedSession.compactRequested 注释)。 */
  compactRequested = false;

  private readonly emit: (e: SessionEvent) => void;
  private readonly requestPermission: PermissionRequestFn;
  private currentAbort: AbortController | null = null;
  private disposed = false;

  constructor(opts: SessionCreateOptions) {
    this.sessionId = opts.sessionId;
    this.projectRoot = opts.projectRoot;
    this.provider = opts.provider;
    this.reasoningMode = opts.reasoningMode;
    this.permissionMode = opts.permissionMode;
    this.autoModeEngine = opts.autoModeEngine ?? 'llm';
    this.agentMode = opts.agentMode ?? 'ama';
    this.surface = opts.surface ?? 'code';
    this.createdAt = Date.now();
    this.lastActivityAt = this.createdAt;
    this.parentSessionId = opts.parentSessionId;
    this.forkPointTurnIdx = opts.forkPointTurnIdx;
    this.emit = opts.emit;
    this.requestPermission = opts.requestPermission;
  }

  isRunning(): boolean {
    return this.currentAbort !== null;
  }

  async send(prompt: string, artifacts?: readonly InputArtifact[]): Promise<SendResult> {
    if (this.disposed) {
      throw new Error(`[real-session ${this.sessionId}] already disposed`);
    }
    // v0.1.4 B1：之前 currentAbort != null 直接 throw，造成"流式中再发"用户面前永远是
    // HANDLER_ERROR。现在改成走 KodaX SDK MessageQueue —— mid-turn drain 把 user-priority
    // 消息排在下一个 LLM call 前消费，等同于"上轮跑完再起一轮"。
    //
    // review HIGH-1: 必须传 agentId=this.sessionId，否则 process-global queue 上
    // 多 in-flight session 时 A 的 prompt 可能被 B 先 drain 跑掉（跨 session 路由）。
    // review HIGH-2: enqueueUserPrompt 内部 MAX_QUEUE_DEPTH guard 防 OOM。
    //
    // OC-31 v0.1.9 — artifacts 仅在"立即起 run"路径生效（直接灌进
    // options.context.inputArtifacts）。queued 路径 KodaX MessageQueue 当前签名
    // 只接 prompt string，artifacts 在 drain 那一轮拿不到。先 fail-loud 反映
    // 限制，让用户知道"图片只能在 idle 时贴"，避免静默丢图。后续可在 SDK
    // 暴露 enqueueWithArtifacts 后改成 queue 也保留。
    if (this.currentAbort) {
      if (artifacts && artifacts.length > 0) {
        throw new Error(
          'Cannot attach images while a turn is running — wait for the current response to finish, then paste again.',
        );
      }
      const queueId = await enqueueUserPrompt(this.sessionId, prompt);
      this.lastActivityAt = Date.now();
      return { queued: true, queueId };
    }

    const abort = new AbortController();
    this.currentAbort = abort;
    this.lastActivityAt = Date.now();

    void this.runRealStream(prompt, abort.signal, artifacts).finally(() => {
      if (this.currentAbort === abort) this.currentAbort = null;
    });
    return { queued: false };
  }

  async cancel(): Promise<void> {
    if (this.currentAbort) {
      this.currentAbort.abort();
    }
    // v0.1.4 B1 review MED-2: 不清 queue 的话 Stop 完下一帧 SDK mid-turn drain
    // 就把残留 prompt 拉起新 run，违反 Stop 语义。filter 按 agentId=sessionId 只清本 session。
    // 失败不抛 —— cancel 是 best-effort，丢失 drain 失败不该阻塞 abort 流程。
    await drainQueueForSession(this.sessionId).catch((err) => {
      console.warn(`[real-session ${this.sessionId}] queue drain on cancel failed:`,
        err instanceof Error ? err.message : err);
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.currentAbort) this.currentAbort.abort();
    // v0.1.4 B1 review MED-3: dispose 后 host map 移除本 session，若 queue 里还有
    // agentId=this.sessionId 的项，SDK drain 行为未定义（可能 error / 静默丢 / 路由
    // 到别的 session）。显式清掉。
    await drainQueueForSession(this.sessionId).catch((err) => {
      console.warn(`[real-session ${this.sessionId}] queue drain on dispose failed:`,
        err instanceof Error ? err.message : err);
    });
  }

  /**
   * FEATURE_030: 把 KodaX `AutoModeAskUser` callback 桥接到 Space askUserBroker。
   * KodaX guardrail 升级路径（denial threshold / circuit breaker / classifier
   * decision escalate）会调这个；broker 推 IPC 弹 AskUserModal；用户答复 → verdict 回 KodaX。
   *
   * 把 signals 从 KodaX shape (ToolCallSignal[]) 映射到 Space schema 的 AskUserSignal：
   * KodaX 内部 signal severity 是 string；Space schema 限 'info'|'warning'|'danger'。
   * 未知 severity → 默认 'info'（保守）。message 缺失 → type 名兜底显示。
   */
  private makeAskUserBridge(): AutoModeAskUser {
    const sid = this.sessionId;
    return async (
      call: Parameters<AutoModeAskUser>[0],
      reason: string,
      signals?: readonly ToolCallSignal[],
    ): Promise<AutoModeAskUserVerdict> => {
      const sigArr = signals?.map((s) => {
        // ToolCallSignal is a discriminated union on `kind`; map each variant to
        // the Space IPC AskUser { type, severity, message } shape.
        if (s.kind === 'dangerous_pattern') {
          // severity: 'high' → 'danger', 'medium' → 'warning'
          let normalized: 'warning' | 'danger';
          if (s.severity === 'high') {
            normalized = 'danger';
          } else if (s.severity === 'medium') {
            normalized = 'warning';
          } else {
            // 当前 SDK 只有 high/medium；若将来引入 'critical'/'low' 等新档，silent downgrade
            // 会让我们看不见。observable warn 让此类 SDK 升级立即冒头，prompt 我们扩 schema。
            console.warn(
              `[real-session ${sid}] unknown dangerous_pattern severity "${String(s.severity)}" → warning; ` +
                `KodaX SDK may have introduced a new severity level`,
            );
            normalized = 'warning';
          }
          return { type: s.kind, severity: normalized, message: s.pattern };
        } else {
          // All other variants: extract a representative message per kind.
          let msg: string;
          if (s.kind === 'shell_redirect_outside') {
            msg = s.target;
          } else if (s.kind === 'package_install') {
            msg = s.manager;
          } else if (s.kind === 'git_write') {
            msg = s.verb;
          } else if (s.kind === 'network') {
            msg = s.tool;
          } else if (s.kind === 'file_modification') {
            msg = s.targets.join(', ');
          } else {
            // 'protected_path' | 'outside_project' — both have `path`
            msg = s.path;
          }
          return { type: s.kind, severity: 'warning' as const, message: msg };
        }
      });
      return askUserBroker.request({
        sessionId: sid,
        reason,
        toolCall: {
          toolId: String(call.id ?? `auto_${call.name}_${Date.now()}`),
          toolName: String(call.name),
          input: call.input,
        },
        signals: sigArr,
      });
    };
  }

  private async runRealStream(
    prompt: string,
    signal: AbortSignal,
    artifacts?: readonly InputArtifact[],
  ): Promise<void> {
    const sid = this.sessionId;
    // SDK subpath dynamic load — 首次调时拉 chunks，后续命中 cache。
    // planModeBlockCheck (同步) 和 runKodaX (异步) 都需要这个 module。
    const sdk = await loadSdkCoding();

    // Permission 统一钩子。KodaX 在工具实际执行前调这个，返回 false → 跳过执行，
    // 返回 true → 正常执行，返回 string → 直接当作 tool result（覆盖执行）。
    // Space PermissionBroker 据当前 mode (FEATURE_029 canonical 3 mode) 短路：
    //   - plan         → 全 deny
    //   - accept-edits → edit/write 类自动批，其他走 ask modal
    //   - auto         → guardrail 内部决策 (FEATURE_030 注入后接管该路径)，
    //                    F030 前先 fallback 到 accept-edits 行为
    //
    // 这是替代"KodaX 内部 permission + Space PermissionBroker 双 broker"方案的关键钩子——
    // 现在只有**一套** permission 决策路径：Space broker。KodaX 看决策结果执行/跳过。
    //
    // 防御：planModeBlockCheck 与本钩子之间存在 TOCTOU 窗口——LLM 决定 tool name 时
    // mode 是 'plan' → planModeBlockCheck 放行 (因为该 tool 不在 blocklist)，
    // 但 LLM 在实际 invoke 前 mode 被改成 'accept-edits'，broker 短路又允许。
    // 这里再 snapshot 一次 mode 用于审计 (broker 仍用现行 mode 决定)。
    const beforeToolExecute: NonNullable<KodaXEvents['beforeToolExecute']> = async (
      tool,
      input,
      meta,
    ) => {
      try {
        const decision = await this.requestPermission({
          toolId: meta?.toolId ?? `auto_${tool}_${Date.now()}`,
          toolName: tool,
          input,
        });
        // session-adapter PermissionRequestFn 返回 'allow_once' | 'allow_always' | 'deny'
        return decision !== 'deny';
      } catch (err) {
        // Permission broker 异常（极少见 — broker 内部已捕获超时）→ 安全侧 deny
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[real-session ${sid}] permission gate error: ${message}`);
        return false;
      }
    };

    // Plan-mode 工具拦截。KodaX 在 LLM 决定调用某工具时先调这个，
    // 返回非 null → KodaX 立即 deny 并把 reason 喂回 LLM（"plan-mode active"），
    // 返回 null → 工具调用继续走 beforeToolExecute permission gate。
    //
    // 闭包读 this.permissionMode — kodaxHost.setPermissionMode 改字段后立即生效，
    // 不需要重建 session。
    const planModeBlockCheck = (
      tool: string,
      _input: Record<string, unknown>,
    ): string | null => {
      if (this.permissionMode !== 'plan') return null;
      // SDK isToolPlanModeAllowed: readonly / planModeAllowed:true → allowed; 其他 → blocked
      // Fail-closed: 未知 tool 返回 false（一律 block）
      if (sdk.isToolPlanModeAllowed(tool)) return null;
      return `[plan] tool '${tool}' is blocked. Plan mode allows only read/search tools — describe the plan instead of executing it.`;
    };

    // Exit plan mode — KodaX 的 exit_plan_mode 工具调用这个让 host 审批 plan 文本。
    // 返回 true → KodaX 退出 plan mode，开始执行；false → 留在 plan mode；
    // 'not-in-plan-mode' → 工具调错了上下文。
    //
    // **安全设计 (security review)**：之前实现是 auto-approve + 自己改 this.permissionMode →
    // 等于 LLM 调一次 exit_plan_mode 工具就拿到 accept-edits 全写权——LLM 自驱动权限升级。
    //
    // 现在改为：**永远拒绝 LLM 自发的退出请求**。要从 plan-mode 出来必须用户手动切 Mode selector。
    // 这样 plan-mode 才是真正的硬闸——LLM 只能在里面 plan，不能"我觉得 plan 好了就开始执行"。
    //
    // 同时 emit 一条 system_notice 把 plan 文本推给 renderer 让用户看到（Phase G 会改成
    // 弹 modal "approve / reject" 真双向交互）。
    const exitPlanMode: NonNullable<KodaXEvents['exitPlanMode']> = async (plan) => {
      if (this.permissionMode !== 'plan') return 'not-in-plan-mode';
      // 防御 truncate：thinking_end schema 上限 256KB，留 1KB 给 prefix/suffix
      const MAX_PLAN_BYTES = 250_000;
      const truncatedPlan =
        plan.length > MAX_PLAN_BYTES
          ? plan.slice(0, MAX_PLAN_BYTES) + '\n\n[plan truncated at 250KB]'
          : plan;
      this.emit({
        kind: 'thinking_end',
        sessionId: sid,
        thinking: `[plan] proposed plan:\n\n${truncatedPlan}\n\n— exit_plan_mode 自动拒绝，请用户手动切 Mode selector 到 'accept-edits' 或 'auto' 来执行。`,
      });
      console.info(
        `[real-session ${sid}] exit_plan_mode rejected (LLM-driven escalation blocked).`,
      );
      return false;
    };

    const events: KodaXEvents = {
      // ---- 流式文本 / 思考 ----
      onTextDelta: (text) => {
        this.lastActivityAt = Date.now();
        this.emit({ kind: 'text_delta', sessionId: sid, text });
      },
      onThinkingDelta: (text) => {
        this.emit({ kind: 'thinking_delta', sessionId: sid, text });
      },
      onThinkingEnd: (thinking) => {
        this.emit({ kind: 'thinking_end', sessionId: sid, thinking });
      },

      // ---- Tool 生命周期 ----
      onToolUseStart: (tool) => {
        this.emit({
          kind: 'tool_start',
          sessionId: sid,
          toolId: tool.id,
          toolName: tool.name,
          input: tool.input,
        });
      },
      onToolInputDelta: (toolName, partialJson, meta) => {
        this.emit({
          kind: 'tool_input_delta',
          sessionId: sid,
          toolName,
          toolId: meta?.toolId,
          partialJson,
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
      onStreamEnd: () => {
        this.emit({ kind: 'stream_end', sessionId: sid });
      },

      // ---- Session / iteration lifecycle ----
      onSessionStart: (info) => {
        this.emit({
          kind: 'session_start',
          sessionId: sid,
          provider: info.provider,
        });
      },
      onIterationStart: (iter, maxIter) => {
        this.emit({ kind: 'iteration_start', sessionId: sid, iter, maxIter });
      },
      onIterationEnd: (info) => {
        this.emit({
          kind: 'iteration_end',
          sessionId: sid,
          iter: info.iter,
          maxIter: info.maxIter,
          tokenCount: info.tokenCount,
          tokenSource: info.tokenSource,
          scope: info.scope,
          usage: info.usage
            ? {
                inputTokens: info.usage.inputTokens,
                outputTokens: info.usage.outputTokens,
                cacheReadInputTokens: info.usage.cachedReadTokens,
                cacheWriteInputTokens: info.usage.cachedWriteTokens,
              }
            : undefined,
        });
      },

      // ---- Context compaction ----
      onCompactStart: () => {
        this.emit({ kind: 'compact_start', sessionId: sid });
      },
      onCompactStats: (info) => {
        this.emit({
          kind: 'compact_stats',
          sessionId: sid,
          tokensBefore: info.tokensBefore,
          tokensAfter: info.tokensAfter,
        });
      },
      onCompactEnd: () => {
        this.emit({ kind: 'compact_end', sessionId: sid });
      },

      // ---- Provider retry / recovery ----
      onRetryAfter: (payload) => {
        this.emit({
          kind: 'retry_after',
          sessionId: sid,
          payload: {
            provider: payload.provider,
            waitMs: payload.waitMs,
            reason: payload.reason,
            source: payload.source,
            attempt: payload.attempt,
            maxAttempts: payload.maxAttempts,
          },
        });
      },
      onProviderRecovery: (event) => {
        this.emit({
          kind: 'provider_recovery',
          sessionId: sid,
          stage: event.stage,
          errorClass: event.errorClass,
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          recoveryAction: event.recoveryAction,
          ladderStep: event.ladderStep,
          fallbackUsed: event.fallbackUsed,
        });
      },

      // ---- Repointel trace ----
      onRepoIntelligenceTrace: (event) => {
        // SDK KodaXRepoIntelligenceTraceEvent: { stage, summary, capability?, trace? }
        // IPC repointelTraceSchema: { kind, mode?, engine?, bridge?, status?, latencyMs?, cacheHit? }
        // Mapping: stage→kind; capability.{mode,engine,bridge,status}→IPC optionals; trace.{daemonLatencyMs,cacheHit}→IPC optionals
        this.emit({
          kind: 'repointel_trace',
          sessionId: sid,
          event: {
            kind: event.stage,
            ...(event.capability !== undefined
              ? {
                  mode: event.capability.mode,
                  engine: event.capability.engine,
                  bridge: event.capability.bridge,
                  status: event.capability.status,
                }
              : {}),
            ...(event.trace !== undefined
              ? {
                  latencyMs: event.trace.daemonLatencyMs ?? event.trace.cliLatencyMs,
                  cacheHit: event.trace.cacheHit,
                }
              : {}),
          },
        });
      },

      // ---- Todo / Plan ----
      onTodoUpdate: (items) => {
        // SDK TodoItem uses `subject` (renamed from `content` in v0.7.42)。
        // IPC todoItemSchema 现已接全量 TodoStatus（含 failed/skipped/cancelled），直接透传真实
        // status，不再 lossy 映射成 completed（失败任务不该显示成 ✓ 完成）。
        this.emit({
          kind: 'todo_update',
          sessionId: sid,
          items: items.map((item) => ({
            id: item.id,
            content: item.subject,
            status: item.status,
            activeForm: item.activeForm,
          })),
        });
      },

      // ---- Managed task / Subagent status ----
      onManagedTaskStatus: (status) => {
        this.emit({
          kind: 'managed_task_status',
          sessionId: sid,
          status: {
            // SDK 0.7.49+ 把 KodaXAgentMode 扩成 'ama'|'sa'|'amaw'（新增 AMA 变体）。
            // Space 的 agentMode 是粗粒度二元（ama=多智能体 / sa=单 agent），'amaw' 仍是
            // AMA 家族 → 在边界折叠成 'ama'，不让新枚举漏进 IPC schema(z.enum['ama','sa'])。
            agentMode: status.agentMode === 'sa' ? 'sa' : 'ama',
            harnessProfile: status.harnessProfile,
            activeWorkerId: status.activeWorkerId,
            activeWorkerTitle: status.activeWorkerTitle,
            childFanoutClass: status.childFanoutClass,
            childFanoutCount: status.childFanoutCount,
            currentRound: status.currentRound,
            maxRounds: status.maxRounds,
            phase: status.phase,
            note: status.note,
            detailNote: status.detailNote,
            events: status.events?.map((ev) => ({
              key: ev.key,
              kind: ev.kind,
              presentation: ev.presentation,
              phase: ev.phase,
              workerId: ev.workerId,
              workerTitle: ev.workerTitle,
              summary: ev.summary,
              detail: ev.detail,
              persistToHistory: ev.persistToHistory,
            })),
            upgradeCeiling: status.upgradeCeiling,
            globalWorkBudget: status.globalWorkBudget,
            budgetUsage: status.budgetUsage,
            budgetApprovalRequired: status.budgetApprovalRequired,
            idleWaiting: status.idleWaiting,
            idleWaitingPendingCount: status.idleWaitingPendingCount,
          },
        });
      },

      // ---- 终止 ----
      onComplete: () => {
        this.emit({ kind: 'session_complete', sessionId: sid });
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.emit({ kind: 'session_error', sessionId: sid, error: message });
      },

      // ---- Permission 钩子 ----
      beforeToolExecute,
      exitPlanMode,
    };

    // FEATURE_030: AutoModeToolGuardrail bootstrap — 仅 mode='auto' 时构造并注入
    // KodaXOptions.guardrails。其他 mode 跳过，零成本（loadAutoRules 不读盘）。
    let guardrails: Guardrail[] | undefined;
    if (this.permissionMode === 'auto') {
      // F030 review MEDIUM#1: 检查 abort 状态早退，避免 cancel 后还白白等 30s I/O
      if (signal.aborted) {
        this.emit({ kind: 'session_error', sessionId: sid, error: 'cancelled' });
        return;
      }
      try {
        const bootstrap = await bootstrapAutoMode({
          askUser: this.makeAskUserBridge(),
          projectRoot: this.projectRoot,
          getCurrentProviderName: () => this.provider,
          // v0.7.42 SDK wired (P0): 用户 /model 设的值或 provider 默认（''）
          getCurrentModel: () => this.model ?? '',
          initialEngine: this.autoModeEngine as AutoModeEngine,
          timeoutMs: 30_000,
          onEngineChange: (engine) => {
            // F030 review MEDIUM#4: session dispose 后 guardrail in-flight classifier
            // 仍可能调回这里——disposed 守护防止往已关 push channel 写
            if (this.disposed) return;
            if (this.autoModeEngine === engine) return;
            const previousEngine = this.autoModeEngine;
            this.autoModeEngine = engine;
            // F030 review MEDIUM#2: 无法从 SDK 区分 denial threshold vs circuit breaker，
            // 两者都是 llm→rules 自动 fallback。用 'denial_threshold' 占位但更老实的做法
            // 是 omit reason 字段——schema reason 是 optional，renderer 看到 undefined 就
            // 显示通用 "engine fallback" 而不是误导成"due to denials"。
            const isAutoFallback = previousEngine === 'llm' && engine === 'rules';
            this.emit({
              kind: 'auto_engine_change',
              sessionId: sid,
              engine,
              // 'manual' 是确定的（user-driven setEngine 走 host.setAutoModeEngine 路径，
              // 不经过 guardrail onEngineChange）；这里都是 SDK 内部自动调，故只能是
              // denial_threshold 或 circuit_breaker——我们没法从 SDK 区分，故 omit。
              ...(isAutoFallback ? {} : { reason: 'manual' as const }),
            });
          },
          log: (level, msg) =>
            level === 'warn'
              ? console.warn(`[auto-mode ${sid}] ${msg}`)
              : console.info(`[auto-mode ${sid}] ${msg}`),
        });
        guardrails = [bootstrap.getGuardrail()];
        console.info(
          `[real-session ${sid}] auto-mode bootstrapped; engine=${this.autoModeEngine}, ` +
          `rules sources=${bootstrap.rulesLoadResult.sources.length}, ` +
          `errors=${bootstrap.rulesLoadResult.errors.length}`,
        );
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : String(err);
        console.warn(`[real-session ${sid}] auto-mode bootstrap failed: ${rawMessage}`);
        // F030 review HIGH#2: 失败 fallback 不是 fail-open——broker (F029) 把 auto 当
        // accept-edits 处理，bash/dangerous 仍弹窗。但用户以为"Auto"全自动跑，应当显著
        // 告知 guardrail 失效。
        //
        // v0.1.4 修复：之前 emit 一条 session_error 携带说明文字想当"通知"用，但
        // session_error 是"session 结束"语义 —— ActivitySpinner 倒扫看到立刻把
        // streaming=false，spinner 消失（实际 SDK 还在跑）。换成 auto_engine_change
        // 带 reason='bootstrap_failed' + details：renderer 端 NotificationsSurface
        // 已经监听 non-manual reason 自动弹持久内联通知，且不污染 streaming 状态。
        //
        // review event-channel MED-1: rawMessage 可能含 SDK error 里嵌的绝对路径
        // (EACCES: /home/user/.secret/...) 或上游 provider 响应里的 auth 报错细节。
        // sanitize 后再塞 details 字段 —— 跟 updater.ts 的 path strip 同套路。
        // 完整 rawMessage 还是会进 console.warn 给开发者排查。
        const sanitizedMessage = sanitizeAutoModeErrorMessage(rawMessage);
        if (this.autoModeEngine !== 'rules') {
          this.autoModeEngine = 'rules';
        }
        this.emit({
          kind: 'auto_engine_change',
          sessionId: sid,
          engine: 'rules',
          reason: 'bootstrap_failed',
          details:
            `Auto mode guardrail failed to initialize: ${sanitizedMessage}. ` +
            `Session continues with accept-edits behavior (no LLM/rules classifier). ` +
            `Check ~/.kodax/auto-rules.jsonc syntax or pick a different mode.`,
        });
      }
    }

    // 拿共享 FileSessionStorage handle 传给 session.storage（让 SDK 真把 jsonl 落盘）。
    // SDK 没暴露 createSessionManager / storage 时返回 undefined — session.storage 缺失
    // 走 SDK 的 no-storage 路径，不影响 LLM 流，warn 在 session-store 里已 log。
    const sessionStorage = await getSessionStorageHandle();

    // FEATURE_038: 自然语言自动触发 skill。
    // buildSkillsPrompt 内部 ensure SDK 全局 SkillRegistry 已 initialize（同一个
    // singleton 给 coding 包的 skill tool 看），返回 getSystemPromptSnippet() 的
    // 列表文本。空串时下面 spread `...(p ? {skillsPrompt: p} : {})` 不会注入
    // 字段——KodaX prompt builder 同样会跳过 skills-addendum section。
    // 失败完全静默（buildSkillsPrompt 内部 catch 并返空串），不阻塞主对话回路。
    const skillsPrompt = await buildSkillsPrompt(this.projectRoot);

    const options: KodaXOptions = {
      provider: this.provider,
      reasoningMode: this.reasoningMode,
      // KodaX agent 形态：AMA (默认) / SA。SDK 默认也是 ama，这里显式传以便用户切换生效。
      agentMode: this.agentMode,
      // SDK 0.7.42 wired (P0): /model + /thinking 设置在下一 turn 生效
      ...(this.model !== undefined ? { model: this.model } : {}),
      ...(this.thinking !== undefined ? { thinking: this.thinking } : {}),
      events,
      abortSignal: signal,
      // scope: 'user' 让 SDK FileSessionStorage 把 session 当成用户对话面板的
      // first-class session 落盘。storage 是 SDK 当前要求的字段——不传则
      // saveSessionSnapshot 静默 no-op，jsonl 不落盘 (用户对话历史丢失)。
      //
      // F045: tag = surface 值（'code' | 'partner'），SDK 持久化进 SessionData.tag
      // → listSessions summary.tag 回带 → session-store mapper 反推回 surface。
      // 这是 Coder / Partner 会话列表彼此独立的持久化依据（KodaX SDK 0.7.49）。
      session: {
        id: sid,
        scope: 'user',
        tag: this.surface,
        storage: sessionStorage as KodaXSessionStorage | undefined,
      },
      context: {
        // gitRoot 用 projectRoot——Space 不再单独求 git root，KodaX 自己会处理边界
        gitRoot: this.projectRoot,
        executionCwd: this.projectRoot,
        planModeBlockCheck,
        // skillsPrompt 仅在非空时挂——避免在 SDK 视角注入空字符串字段。
        ...(skillsPrompt ? { skillsPrompt } : {}),
        // OC-31 v0.1.9 — 用户粘贴 / 拖拽的图片走这条路径。SDK
        // buildPromptMessageContent(prompt, inputArtifacts) 会自动把每张图拼成
        // multimodal content block ({type:'image', path, mediaType})。空数组就不传
        // —— 让 SDK 走纯文本 fast path，不额外做 type checking 开销。
        ...(artifacts && artifacts.length > 0
          ? {
              inputArtifacts: artifacts.map((a) => ({
                kind: 'image' as const,
                path: a.path,
                ...(a.mediaType ? { mediaType: a.mediaType } : {}),
                source: 'user-inline' as const,
              })),
            }
          : {}),
        // /compact 标记: 把 currentTokens 顶到 999B,SDK needsCompaction 立即触发
        // 完事后 finally 清掉 flag (不管成功还是失败)
        ...(this.compactRequested
          ? {
              contextTokenSnapshot: {
                currentTokens: 999_000_000,
                baselineEstimatedTokens: 999_000_000,
                source: 'estimate' as const,
              },
            }
          : {}),
      },
      guardrails,
      // FEATURE_221 (SDK 0.7.47): 注入 Space 自己的产品手册,让内建 kodax_manual
      // tool 在用户问"怎么粘图/怎么开 popout/怎么配 provider"时返回 Space 形态的
      // 答案 —— 不是默认 KodaX REPL 视角 (~/.kodax/config / npm install).
      // 同 id (overview / install / quickstart / providers / config / sessions /
      // commands / skills / permissions / troubleshooting) override KodaX base 条目;
      // 新 id (popouts / smart-popout-director / image-paste / sidebar-resize /
      // keyboard-shortcuts) 纯增量. SDK 4KB body cap 之内.
      selfManual: {
        productName: SPACE_PRODUCT_NAME,
        topics: SPACE_MANUAL_TOPICS,
      },
    };

    try {
      // runManagedTask（不是 runKodaX）：这是 agentMode-aware 分派器——
      // agentMode='sa' 走直路，'ama'(默认) 走 Scout/Worker 链 + Sidecar Verifier。
      // runKodaX 是 SA-only 入口、静默忽略 options.agentMode；直接调它会让 AMA/SA
      // 选择器空接（每个 turn 都跑 SA、无 verifier → "只报计划就停" 没人拦截）。
      // 见 task-engine.ts dispatchManagedTask / runner-driven.ts(verifier 挂载点)。
      await sdk.runManagedTask(options, prompt);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.emit({ kind: 'session_error', sessionId: sid, error: 'cancelled', category: 'cancelled', retriable: true });
      } else if (!signal.aborted) {
        // OC-11: SDK 原始异常字符串往往含 stack / HTTP 内部细节，对用户没用。
        // wrapSdkError 分类并产出友好文案 + action；main 日志保留 debugMessage 便于排查。
        // OC-23: rate_limit / 5xx 情况下，从 Retry-After header (Anthropic 还有
        // retry-after-ms 扩展) 算出建议等待时间，UI 给倒计时按钮。SDK 找不到 header
        // → parseRetryAfter 返 backoff fallback，我们当 undefined 处理（不显示倒计时，
        // 只显示普通 Retry 按钮）。
        const retryAfterMs = await extractRetryAfterMs(err);
        const wrapped = wrapSdkError(err, retryAfterMs !== undefined ? { retryAfterMs } : undefined);
        console.warn(`[real-session ${sid}] sdk error (${wrapped.category}): ${wrapped.debugMessage}`);
        // OC-23 review HIGH-2: stamp 绝对时间戳在 main 端 (emit 时刻)，避免 renderer
        // composeMessages 每次 events 变都重新 Date.now()+delta 让倒计时不断推后。
        const retryAvailableAt = wrapped.retryAfterMs !== undefined
          ? Date.now() + wrapped.retryAfterMs
          : undefined;
        this.emit({
          kind: 'session_error',
          sessionId: sid,
          error: wrapped.userMessage,
          category: wrapped.category,
          retriable: wrapped.retriable,
          ...(wrapped.action ? { action: wrapped.action } : {}),
          ...(retryAvailableAt !== undefined ? { retryAvailableAt } : {}),
        });
      }
    } finally {
      // /compact 标记是 one-shot — 不论本轮成功 / 中断 / 报错，consume 后清掉
      // 避免下一轮还误触发
      if (this.compactRequested) this.compactRequested = false;
    }
  }
}
