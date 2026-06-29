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
      console.warn(
        `[real-session] failed to load @kodax-ai/kodax/llm subpath: ${err instanceof Error ? err.message : err}`,
      );
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
  return (
    msg
      .replace(/([A-Za-z]:[\\/][^\s]+|\\\\[^\s]+|\/[A-Za-z][^\s]+)/g, '<path>')
      .slice(0, 240)
      .trim() || 'unknown error'
  );
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
import { computeToolBlockReason, isPartnerToolAllowed } from './partner-tools.js';
import { ensureCreateArtifactToolRegistered } from '../artifact/create-artifact-tool.js';
import { withArtifactContext } from '../artifact/run-context.js';
import { runWithSessionQueueScope } from './session-queue-guard.js';
import { getSessionStorageHandle } from './session-store.js';
import { wrapSdkError } from './sdk-errors.js';
import { buildSkillsPrompt } from './skills-prompt.js';
import {
  createSpaceSdkExtensionRuntime,
  getSpaceSdkExtensionConfigGeneration,
  type SpaceSdkExtensionRuntimeHandle,
} from './sdk-extensions.js';
import { SPACE_MANUAL_TOPICS, SPACE_PRODUCT_NAME } from './space-manual-topics.js';
import { workflowPolicyStore } from './workflow-policy.js';
import { pushToRenderer } from '../ipc/push.js';
import { childRunId, buildChildActivity } from './workflow-activity.js';
import type {
  ManagedSession,
  PermissionRequestFn,
  SendOptions,
  SendResult,
  SessionCreateOptions,
} from './session-adapter.js';
import {
  dequeueNextUserPromptForSession,
  drainQueueForSession,
  enqueueUserPrompt,
} from '../ipc/queue.js';
import { reasoningModeToEffort } from './reasoning-effort.js';

type SpaceReasoning = 'off' | 'auto' | 'quick' | 'balanced' | 'deep';

/** F065：推一条子 agent 活动到 renderer（仅 discrete 事件调用——控 IPC 量，不推每个 text delta）。 */
function pushChildActivity(
  meta: Parameters<typeof buildChildActivity>[0],
  kind: 'tool_use' | 'tool_result' | 'end',
  extra: { toolName?: string },
): void {
  const payload = buildChildActivity(meta, kind, extra);
  if (payload) pushToRenderer('workflow.activity', payload);
}

function clampSessionEventText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length <= 262_144) return value;
  return `${value.slice(0, 262_120)}\n\n[truncated]`;
}

const STREAM_DELTA_FLUSH_MS = 33;

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
  /** AMA / AMAW / SA agent mode. */
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
  private extensionRuntimeHandle: SpaceSdkExtensionRuntimeHandle | undefined = undefined;
  private extensionRuntimeLoad: Promise<SpaceSdkExtensionRuntimeHandle | undefined> | null = null;
  private extensionRuntimeGeneration: number | null = null;
  private readonly extensionRuntimeDisposePromises = new WeakMap<object, Promise<void>>();

  constructor(opts: SessionCreateOptions) {
    this.sessionId = opts.sessionId;
    this.projectRoot = opts.projectRoot;
    this.provider = opts.provider;
    this.model = opts.model;
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

  async send(
    prompt: string,
    artifacts?: readonly InputArtifact[],
    options?: SendOptions,
  ): Promise<SendResult> {
    if (this.disposed) {
      throw new Error(`[real-session ${this.sessionId}] already disposed`);
    }

    // Follow-up prompts are queued explicitly: interrupt goes into the SDK
    // main-thread queue for safe mid-turn drains, while after-turn stays in
    // Space's per-session queue until this turn settles.
    if (this.currentAbort) {
      if (artifacts && artifacts.length > 0) {
        throw new Error(
          'Cannot attach images while a turn is running; wait for the current response to finish, then paste again.',
        );
      }
      const queueMode = options?.queueMode ?? 'interrupt';
      const queueId = await enqueueUserPrompt(this.sessionId, prompt, queueMode);
      this.lastActivityAt = Date.now();
      return { queued: true, queueId, queueMode };
    }
    this.startRun(prompt, artifacts);
    return { queued: false };
  }

  private startRun(prompt: string, artifacts?: readonly InputArtifact[]): void {
    const abort = new AbortController();
    this.currentAbort = abort;
    this.lastActivityAt = Date.now();

    void this.runRealStream(prompt, abort.signal, artifacts).finally(() => {
      if (this.currentAbort === abort) this.currentAbort = null;
      if (!this.disposed && !abort.signal.aborted) {
        this.startQueuedPromptIfIdle();
      }
    });
  }

  private startQueuedPromptIfIdle(): void {
    if (this.disposed || this.currentAbort !== null) return;
    const nextPrompt = dequeueNextUserPromptForSession(this.sessionId);
    if (nextPrompt === undefined) return;
    this.emit({
      kind: 'queued_user_prompt_started',
      sessionId: this.sessionId,
      queueMode: nextPrompt.queueMode,
      content: clampSessionEventText(nextPrompt.content) ?? nextPrompt.content,
    });
    this.startRun(nextPrompt.content);
  }

  private async ensureExtensionRuntime(
    retryStale = true,
  ): Promise<SpaceSdkExtensionRuntimeHandle | undefined> {
    const generation = getSpaceSdkExtensionConfigGeneration();
    if (
      this.extensionRuntimeGeneration !== null &&
      this.extensionRuntimeGeneration !== generation
    ) {
      await this.disposeExtensionRuntime();
    }
    if (this.extensionRuntimeHandle !== undefined) return this.extensionRuntimeHandle;
    if (this.extensionRuntimeLoad === null) {
      this.extensionRuntimeGeneration = generation;
      this.extensionRuntimeLoad = createSpaceSdkExtensionRuntime({ projectRoot: this.projectRoot })
        .then(async (handle) => {
          if (this.disposed || this.extensionRuntimeGeneration !== generation) {
            if (handle !== undefined) {
              await this.disposeExtensionRuntimeHandle(handle, 'after late init');
            }
            this.extensionRuntimeHandle = undefined;
            this.extensionRuntimeLoad = null;
            this.extensionRuntimeGeneration = null;
            if (!this.disposed && retryStale) {
              return this.ensureExtensionRuntime(false);
            }
            return undefined;
          }
          this.extensionRuntimeHandle = handle;
          return handle;
        })
        .catch((err) => {
          this.extensionRuntimeLoad = null;
          this.extensionRuntimeGeneration = null;
          console.warn(
            `[real-session ${this.sessionId}] SDK extension runtime unavailable:`,
            err instanceof Error ? err.message : err,
          );
          return undefined;
        });
    }
    return this.extensionRuntimeLoad;
  }

  private async disposeExtensionRuntimeHandle(
    handle: SpaceSdkExtensionRuntimeHandle,
    reason: string,
  ): Promise<void> {
    const runtimeKey = handle.runtime as object;
    const existing = this.extensionRuntimeDisposePromises.get(runtimeKey);
    if (existing) {
      await existing;
      return;
    }
    const disposePromise = handle.runtime.dispose().catch((err) => {
      console.warn(
        `[real-session ${this.sessionId}] SDK extension runtime dispose ${reason} failed:`,
        err instanceof Error ? err.message : err,
      );
    });
    this.extensionRuntimeDisposePromises.set(runtimeKey, disposePromise);
    await disposePromise;
  }

  private async disposeExtensionRuntime(): Promise<void> {
    const pending = this.extensionRuntimeLoad;
    const handle =
      this.extensionRuntimeHandle ?? (pending ? await pending.catch(() => undefined) : undefined);
    this.extensionRuntimeHandle = undefined;
    this.extensionRuntimeLoad = null;
    this.extensionRuntimeGeneration = null;
    if (handle !== undefined) {
      await this.disposeExtensionRuntimeHandle(handle, 'cleanup');
    }
  }

  async cancel(): Promise<void> {
    if (this.currentAbort) {
      this.currentAbort.abort();
    }
    // Stop should also drop queued follow-up prompts so cancel means
    // "do not continue". Drain failure must not block abort.
    await drainQueueForSession(this.sessionId).catch((err) => {
      console.warn(
        `[real-session ${this.sessionId}] queue drain on cancel failed:`,
        err instanceof Error ? err.message : err,
      );
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.currentAbort) this.currentAbort.abort();
    // Dispose removes this session from the host map; drop any remaining
    // Space-owned queued prompts for the same session.
    await drainQueueForSession(this.sessionId).catch((err) => {
      console.warn(
        `[real-session ${this.sessionId}] queue drain on dispose failed:`,
        err instanceof Error ? err.message : err,
      );
    });
    await this.disposeExtensionRuntime();
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
    const isStopped = (): boolean => this.disposed || signal.aborted;
    const emitRawLive = (event: SessionEvent, force = false): void => {
      if (this.disposed) return;
      if (!force && isStopped()) return;
      this.emit(event);
    };
    type StreamDeltaKind = 'text_delta' | 'thinking_delta';
    const streamDeltaBuffer: Array<{ kind: StreamDeltaKind; text: string }> = [];
    let streamDeltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStreamDeltaFlushTimer = (): void => {
      if (streamDeltaFlushTimer === null) return;
      clearTimeout(streamDeltaFlushTimer);
      streamDeltaFlushTimer = null;
    };
    const flushStreamDeltas = (force = false): void => {
      clearStreamDeltaFlushTimer();
      if (streamDeltaBuffer.length === 0) return;
      const pending = streamDeltaBuffer.splice(0);
      for (const delta of pending) {
        if (delta.kind === 'text_delta') {
          emitRawLive({ kind: 'text_delta', sessionId: sid, text: delta.text }, force);
        } else {
          emitRawLive({ kind: 'thinking_delta', sessionId: sid, text: delta.text }, force);
        }
      }
    };
    const scheduleStreamDeltaFlush = (): void => {
      if (streamDeltaFlushTimer !== null) return;
      streamDeltaFlushTimer = setTimeout(() => flushStreamDeltas(), STREAM_DELTA_FLUSH_MS);
    };
    const emitStreamDelta = (kind: StreamDeltaKind, text: string): void => {
      if (isStopped() || text.length === 0) return;
      const last = streamDeltaBuffer[streamDeltaBuffer.length - 1];
      if (last?.kind === kind) {
        last.text += text;
      } else {
        streamDeltaBuffer.push({ kind, text });
      }
      scheduleStreamDeltaFlush();
    };
    const emitLive = (event: SessionEvent): void => {
      if (event.kind !== 'text_delta' && event.kind !== 'thinking_delta') {
        flushStreamDeltas();
      }
      emitRawLive(event);
    };

    // 终止事件收口（修复"500 后历史位置错乱"）。
    //
    // 背景：SDK AMA 路径（runManagedTask 默认）遇到错误时是
    //   catch { onError(err); throw }  finally { onComplete() }
    // 所以同一个错误会触发 **onError + onComplete + 外层 catch** 三次，naive 实现会往
    // 事件流里塞 [session_error, session_complete, session_error] 三个终止事件。
    // 而 renderer composeMessages.findSegmentEnd 假设每个用户轮次后只有 **一个**
    // 终止事件——多出来的两个会把后续 user message ↔ event 段的配对整体错位，表现为
    // "错误信息挂错气泡 / 回复被甩到列表底部"。
    //
    // 收口策略：每轮至多发一个终止事件。
    //   - onError 只 **暂存** error，不直接发射（SA 路径不 throw，靠这里捕获）
    //   - onComplete 仅在 **没有** 暂存错误时才发 session_complete（错误轮不报"完成"）
    //   - 真正的 session_error 由 emitTerminalError 统一发（wrapSdkError 富文案 + retry）
    //     AMA 走外层 catch、SA 走 await 之后的补发——两条路径互斥，且 latch 防重发。
    let pendingTerminalError: unknown = null;
    let terminalEmitted = false;
    const emitTerminalError = async (err: unknown): Promise<void> => {
      if (terminalEmitted || isStopped()) return;
      terminalEmitted = true;
      // OC-11: SDK 原始异常字符串往往含 stack / HTTP 内部细节，对用户没用。
      // wrapSdkError 分类并产出友好文案 + action；main 日志保留 debugMessage 便于排查。
      // OC-23: rate_limit / 5xx 情况下，从 Retry-After header 算出建议等待时间，UI 给倒计时。
      const retryAfterMs = await extractRetryAfterMs(err);
      // review MEDIUM-3: 顶部 isStopped() 在 await 前——await 期间 session 可能被 dispose /
      // abort，此刻再发就是往已关 channel 写。await 后复检一次。
      if (isStopped()) return;
      const wrapped = wrapSdkError(err, retryAfterMs !== undefined ? { retryAfterMs } : undefined);
      console.warn(
        `[real-session ${sid}] sdk error (${wrapped.category}): ${wrapped.debugMessage}`,
      );
      // OC-23 review HIGH-2: stamp 绝对时间戳在 main 端（emit 时刻），避免 renderer
      // composeMessages 每次 events 变都重新 Date.now()+delta 让倒计时不断推后。
      const retryAvailableAt =
        wrapped.retryAfterMs !== undefined ? Date.now() + wrapped.retryAfterMs : undefined;
      emitLive({
        kind: 'session_error',
        sessionId: sid,
        error: wrapped.userMessage,
        category: wrapped.category,
        retriable: wrapped.retriable,
        ...(wrapped.action ? { action: wrapped.action } : {}),
        ...(retryAvailableAt !== undefined ? { retryAvailableAt } : {}),
      });
    };
    const pushChildActivityLive = (
      meta: Parameters<typeof pushChildActivity>[0],
      kind: Parameters<typeof pushChildActivity>[1],
      extra: Parameters<typeof pushChildActivity>[2],
    ): void => {
      if (isStopped()) return;
      pushChildActivity(meta, kind, extra);
    };
    // SDK subpath dynamic load — 首次调时拉 chunks，后续命中 cache。
    // planModeBlockCheck (同步) 和 runKodaX (异步) 都需要这个 module。
    const sdk = await loadSdkCoding();

    // F058: register the in-process create_artifact tool once (global registry).
    // Lazy here (first run) so the agent's tool schema includes it; idempotent.
    ensureCreateArtifactToolRegistered(sdk);

    type SdkAskUserQuestionOptions = Parameters<NonNullable<KodaXEvents['askUser']>>[0];
    type SdkAskUserMultiOptions = Parameters<NonNullable<KodaXEvents['askUserMulti']>>[0];
    type SdkAskUserInputOptions = Parameters<NonNullable<KodaXEvents['askUserInput']>>[0];

    const cancelledToolResult =
      sdk.CANCELLED_TOOL_RESULT_MESSAGE ?? '[Cancelled] Operation cancelled by user';
    const requestSdkUserQuestion = async (
      options: SdkAskUserQuestionOptions,
    ): Promise<string | undefined> => {
      const kind = options.kind ?? 'select';
      if (kind === 'select' && (!options.options || options.options.length === 0)) {
        console.warn(
          `[real-session ${sid}] SDK askUser select request had no options; cancelling prompt`,
        );
        return undefined;
      }
      return askUserBroker.requestQuestion({
        sessionId: sid,
        kind,
        question: options.question,
        ...(kind === 'select' ? { options: options.options } : {}),
        ...(options.multiSelect !== undefined ? { multiSelect: options.multiSelect } : {}),
        ...(options.default !== undefined ? { default: options.default } : {}),
      });
    };

    const requestSdkUserInput = (options: SdkAskUserInputOptions): Promise<string | undefined> =>
      askUserBroker.requestQuestion({
        sessionId: sid,
        kind: 'input',
        question: options.question,
        ...(options.default !== undefined ? { default: options.default } : {}),
      });

    const requestSdkUserMulti = async (
      options: SdkAskUserMultiOptions,
    ): Promise<Record<string, string> | undefined> => {
      const answers: Record<string, string> = {};
      for (const question of options.questions) {
        if (!question.options || question.options.length === 0) {
          console.warn(
            `[real-session ${sid}] SDK askUserMulti select request had no options; cancelling prompt`,
          );
          return undefined;
        }
        const answer = await askUserBroker.requestQuestion({
          sessionId: sid,
          kind: 'select',
          question: question.question,
          ...(question.header !== undefined ? { header: question.header } : {}),
          options: question.options,
          ...(question.multiSelect !== undefined ? { multiSelect: question.multiSelect } : {}),
        });
        if (answer === undefined) return undefined;
        answers[question.question] = answer;
      }
      return answers;
    };

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
      // F047 defense-in-depth (security review MEDIUM)：Partner 白名单已在 planModeBlockCheck
      // 拦下（LLM 拿到 reason）。这里再兜一道 fail-closed——万一 SDK 改 hook 顺序 / 新增不经
      // planModeBlockCheck 的调用路径（如 MCP 工具），Partner 仍不会执行非白名单工具。
      if (
        this.surface === 'partner' &&
        !isPartnerToolAllowed(tool, sdk.resolveToolCapability(tool))
      ) {
        return false;
      }
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
    // F047: Partner surface 工具白名单（non-bash-subset）+ plan-mode 拦截统一收敛到
    // computeToolBlockReason（纯函数，见 partner-tools.ts）。Partner 只放行 SDK 判定的只读
    // tier（resolveToolCapability==='read'）+ 显式 web 研究工具；Coder 行为不变（plan-mode 原样）。
    // SDK 查询走 thunk 保持惰性。
    const planModeBlockCheck = (tool: string, _input: Record<string, unknown>): string | null =>
      computeToolBlockReason({
        surface: this.surface,
        permissionMode: this.permissionMode,
        tool,
        resolveCapability: () => sdk.resolveToolCapability(tool),
        isPlanModeAllowed: () => sdk.isToolPlanModeAllowed(tool),
      });

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
      emitLive({
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
      onTextDelta: (text, meta) => {
        this.lastActivityAt = Date.now();
        // F065: 子 agent 文本不进主 transcript（不淹）；不逐 delta 推活动（控量），
        // 子 agent 进度由 snapshot.latestMessage + discrete tool 活动体现。
        if (childRunId(meta)) return;
        emitStreamDelta('text_delta', text);
      },
      onThinkingDelta: (text, meta) => {
        if (childRunId(meta)) return;
        emitStreamDelta('thinking_delta', text);
      },
      onThinkingEnd: (thinking, meta) => {
        if (childRunId(meta)) return;
        emitLive({ kind: 'thinking_end', sessionId: sid, thinking });
      },

      // ---- Tool 生命周期 ----
      onToolUseStart: (tool, meta) => {
        if (childRunId(meta)) {
          pushChildActivityLive(meta, 'tool_use', { toolName: tool.name });
          return;
        }
        emitLive({
          kind: 'tool_start',
          sessionId: sid,
          toolId: tool.id,
          toolName: tool.name,
          input: tool.input,
        });
      },
      onToolInputDelta: (toolName, partialJson, meta) => {
        // F065: 子 agent 的 partial-JSON 流不进主 transcript（不淹）；不逐 delta 推活动（控量）。
        if (childRunId(meta)) return;
        emitLive({
          kind: 'tool_input_delta',
          sessionId: sid,
          toolName,
          toolId: meta?.toolId,
          partialJson,
        });
      },
      onToolResult: (result, meta) => {
        if (childRunId(meta)) {
          pushChildActivityLive(meta, 'tool_result', { toolName: result.name });
          return;
        }
        emitLive({
          kind: 'tool_result',
          sessionId: sid,
          toolId: result.id,
          toolName: result.name,
          content: result.content,
        });
      },
      onToolProgress: (update) => {
        emitLive({
          kind: 'tool_progress',
          sessionId: sid,
          toolId: update.id,
          message: update.message,
        });
      },
      onStreamEnd: () => {
        emitLive({ kind: 'stream_end', sessionId: sid });
      },
      // F065: 子 agent 离开 executor 边界——封口其活动流（不进主 transcript）。
      onChildActivityEnd: (meta) => {
        pushChildActivityLive(meta, 'end', {});
      },

      // ---- Session / iteration lifecycle ----
      onSessionStart: (info) => {
        emitLive({
          kind: 'session_start',
          sessionId: sid,
          provider: info.provider,
        });
      },
      onIterationStart: (iter, maxIter) => {
        emitLive({ kind: 'iteration_start', sessionId: sid, iter, maxIter });
      },
      onIterationEnd: (info) => {
        emitLive({
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
      onMidTurnUserMessages: (contents) => {
        for (const content of contents) {
          const clamped = clampSessionEventText(content);
          if (clamped === undefined || clamped.trim() === '') continue;
          emitLive({
            kind: 'mid_turn_user_prompt',
            sessionId: sid,
            content: clamped,
          });
        }
      },

      // ---- Context compaction ----
      onCompactStart: () => {
        emitLive({ kind: 'compact_start', sessionId: sid });
      },
      onCompactStats: (info) => {
        emitLive({
          kind: 'compact_stats',
          sessionId: sid,
          tokensBefore: info.tokensBefore,
          tokensAfter: info.tokensAfter,
        });
      },
      onCompactEnd: () => {
        emitLive({ kind: 'compact_end', sessionId: sid });
      },

      // ---- Provider retry / recovery ----
      onRetryAfter: (payload) => {
        emitLive({
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
        emitLive({
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
        // IPC repointelTraceSchema keeps the historic repointel_* name but now
        // carries the built-in repo-intelligence mode/engine/status fields.
        emitLive({
          kind: 'repointel_trace',
          sessionId: sid,
          event: {
            kind: event.stage,
            ...(event.capability !== undefined
              ? {
                  mode: event.capability.mode,
                  engine: event.capability.engine,
                  status: event.capability.status,
                }
              : {}),
            ...(event.trace !== undefined
              ? {
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
        emitLive({
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

      onSidecarMessage: (message) => {
        emitLive({
          kind: 'sidecar_message',
          sessionId: sid,
          message: {
            source: message.source,
            verdict: message.verdict,
            recipient: message.recipient,
            delivery: message.delivery,
            content: clampSessionEventText(message.content) ?? '',
            ...(message.suggestedFix !== undefined
              ? { suggestedFix: clampSessionEventText(message.suggestedFix)! }
              : {}),
            ...(message.trace !== undefined
              ? { trace: clampSessionEventText(message.trace)! }
              : {}),
          },
        });
      },
      onTodoDriftWarning: (warning) => {
        emitLive({
          kind: 'todo_drift_warning',
          sessionId: sid,
          warning: {
            kind: warning.kind,
            toolName: warning.toolName,
            count: warning.count,
            pendingCount: warning.pendingCount,
            openCount: warning.openCount,
            ...(warning.toolCallId !== undefined ? { toolCallId: warning.toolCallId } : {}),
            ...(warning.firstPendingTodoId !== undefined
              ? { firstPendingTodoId: warning.firstPendingTodoId }
              : {}),
            ...(warning.firstPendingTodoSubject !== undefined
              ? { firstPendingTodoSubject: warning.firstPendingTodoSubject }
              : {}),
          },
        });
      },
      // ---- Managed task / Subagent status ----
      onManagedTaskStatus: (status) => {
        emitLive({
          kind: 'managed_task_status',
          sessionId: sid,
          status: {
            // Space now keeps the SDK's three agent modes intact: ama / amaw / sa.
            agentMode: status.agentMode,
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
      // 注意：AMA 路径 onComplete 在 finally 里触发，错误轮也会被调一次（pre-FEATURE_100
      // 行为，见 SDK runner-driven.ts）。所以这里必须用 pendingTerminalError 把错误轮的
      // session_complete 吞掉——否则错误轮会同时冒出 complete + error 两个终止事件。
      onComplete: () => {
        if (pendingTerminalError !== null) return;
        emitLive({ kind: 'session_complete', sessionId: sid });
      },
      // 只暂存，不直接发射——真正的 session_error 由 emitTerminalError 统一收口（去重 + 富文案）。
      onError: (err) => {
        pendingTerminalError = err;
      },

      // ---- Interactive user questions ----
      askUser: async (options) => (await requestSdkUserQuestion(options)) ?? cancelledToolResult,
      askUserMulti: requestSdkUserMulti,
      askUserInput: requestSdkUserInput,

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
        // review HIGH-2: 取消提示必须在 aborted 下照常发，故用 this.emit 而非 emitLive——
        // 后者的 isStopped() 含 aborted，会把这条 cancelled 吞掉。但 disposed 时 channel 已关、
        // appendEvent 也会 drop，跳过 emit。字段与 catch AbortError 分支 / BottomBar 乐观取消
        // 对齐（category + retriable），避免同一"取消"在不同路径渲染形态不一致。
        if (!this.disposed) {
          this.emit({
            kind: 'session_error',
            sessionId: sid,
            error: 'cancelled',
            category: 'cancelled',
            retriable: true,
          });
        }
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
            emitLive({
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
        emitLive({
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
    const extensionRuntimeHandle = await this.ensureExtensionRuntime();

    const options: KodaXOptions = {
      provider: this.provider,
      effort: reasoningModeToEffort(this.reasoningMode),
      // KodaX agent 形态：AMA / AMAW / SA。显式传以便用户切换生效。
      agentMode: this.agentMode,
      // SDK 0.7.42 wired (P0): /model + /thinking 设置在下一 turn 生效
      ...(this.model !== undefined ? { model: this.model } : {}),
      ...(this.thinking !== undefined ? { thinking: this.thinking } : {}),
      events,
      ...(extensionRuntimeHandle !== undefined
        ? { extensionRuntime: extensionRuntimeHandle.runtime }
        : {}),
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
                source: a.source,
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
      // F064: Workflow Host Policy —— 治理自然语言 AMAW 自启（off/confirm/on，默认 confirm）
      // + caps（已 clamp 到 SDK 硬上限）。SDK 据此决定是否自启 + 钳运行时上限/审批/进程上限。
      workflowHostPolicy: workflowPolicyStore.get(),
    };

    try {
      // runManagedTask（不是 runKodaX）：这是 agentMode-aware 分派器——
      // agentMode='sa' 走直路，'ama'/'amaw' 走 Scout/Worker 链 + Sidecar Verifier。
      // runKodaX 是 SA-only 入口、静默忽略 options.agentMode；直接调它会让 agent mode
      // 选择器空接（每个 turn 都跑 SA、无 verifier → "只报计划就停" 没人拦截）。
      // 见 task-engine.ts dispatchManagedTask / runner-driven.ts(verifier 挂载点)。
      // F058: bind artifact attribution context for this run so the
      // create_artifact tool handler (global registration) knows which
      // session/surface to attribute to (ALS — concurrency-safe across sessions).
      await withArtifactContext(
        { sessionId: sid, surface: this.surface, projectRoot: this.projectRoot },
        () => runWithSessionQueueScope(sid, () => sdk.runManagedTask(options, prompt)),
      );
      // SA 路径（agentMode='sa'）错误时 onError 触发但 Promise **resolve**（success:false），
      // 不 throw——外层 catch 不会跑。所以这里 await 之后补发暂存的错误。
      // AMA 路径错误时会 throw，控制流跳到 catch，这一行不会执行（两条路径互斥）。
      if (pendingTerminalError !== null && !signal.aborted) {
        await emitTerminalError(pendingTerminalError);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户取消：必须用 this.emit 而非 emitLive——此刻 signal.aborted=true，emitLive 的
        // isStopped() 会把"cancelled"通知吞掉。但 disposed 时 channel 已关，无意义且应跳过。
        // 同时置 terminalEmitted，与 emitTerminalError 共享同一 latch，杜绝任何重发。
        if (!this.disposed && !terminalEmitted) {
          terminalEmitted = true;
          flushStreamDeltas(true);
          emitRawLive(
            {
              kind: 'session_error',
              sessionId: sid,
              error: 'cancelled',
              category: 'cancelled',
              retriable: true,
            },
            true,
          );
        }
      } else if (!signal.aborted) {
        // AMA 路径：SDK catch 已先调过 onError(暂存 err)，这里 throw 上来。统一走
        // emitTerminalError 收口（内部 latch 去重 + wrapSdkError 富文案 + retry 倒计时）。
        await emitTerminalError(err);
      } else if (pendingTerminalError !== null && !terminalEmitted) {
        // 竞态：SDK error 与用户 cancel 几乎同时发生（signal 在 throw 前已 aborted）。
        // 终止事件不再发（host 端在 s.cancel() 前已推过 cancelled，UI 已停），但不能让
        // SDK error 彻底无声蒸发——落一条 main 日志便于排查（review HIGH-2）。
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[real-session ${sid}] sdk error suppressed by concurrent cancel: ${msg}`);
      }
    } finally {
      flushStreamDeltas();
      // /compact 标记是 one-shot — 不论本轮成功 / 中断 / 报错，consume 后清掉
      // 避免下一轮还误触发
      if (this.compactRequested) this.compactRequested = false;
    }
  }
}
