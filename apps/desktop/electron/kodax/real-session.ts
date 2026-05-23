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
import type {
  AutoModeAskUser,
  AutoModeAskUserVerdict,
  AutoModeEngineKodaX,
  Guardrail,
  KodaXOptions,
  KodaXEvents,
  RunnerToolCall,
  ToolCallSignal,
} from '@kodax-ai/kodax/coding';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { askUserBroker } from '../permission/ask-user-broker.js';
import { bootstrapAutoMode } from './auto-mode-bootstrap.js';
import type {
  ManagedSession,
  PermissionRequestFn,
  SessionCreateOptions,
} from './session-adapter.js';

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
      call: RunnerToolCall,
      reason: string,
      signals?: readonly ToolCallSignal[],
    ): Promise<AutoModeAskUserVerdict> => {
      const sigArr = signals?.map((s) => {
        const sev = s.severity;
        let normalized: 'info' | 'warning' | 'danger';
        if (sev === 'warning' || sev === 'danger') {
          normalized = sev;
        } else if (sev === 'info' || sev === undefined) {
          normalized = 'info';
        } else {
          // F030 review HIGH#1: 未知 severity 静默降到 info 会让 'critical' 等
          // 未来 KodaX 引入的更高级别 signal silent downgrade。observable warn
          // 让此类升级可被诊断。当前 KodaX 0.7.40 只有 info/warning/danger 三档；
          // 若 SDK 引入 'critical' 这条 warn 会立即冒头，prompt 我们扩 schema。
          console.warn(
            `[real-session ${sid}] unknown signal severity "${sev}" mapped to info ` +
            `(type=${String(s.type)}); KodaX SDK may have introduced new severity level`,
          );
          normalized = 'info';
        }
        return {
          type: String(s.type ?? 'unknown'),
          severity: normalized,
          message: String(s.message ?? s.type ?? ''),
        };
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

  private async runRealStream(prompt: string, signal: AbortSignal): Promise<void> {
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
                cacheReadInputTokens: info.usage.cacheReadInputTokens,
                cacheWriteInputTokens: info.usage.cacheCreationInputTokens,
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
        this.emit({
          kind: 'repointel_trace',
          sessionId: sid,
          event: {
            kind: event.kind,
            mode: event.mode,
            engine: event.engine,
            bridge: event.bridge,
            status: event.status,
            latencyMs: event.latencyMs,
            cacheHit: event.cacheHit,
          },
        });
      },

      // ---- Todo / Plan ----
      onTodoUpdate: (items) => {
        this.emit({
          kind: 'todo_update',
          sessionId: sid,
          items: items.map((item) => ({
            id: item.id,
            content: item.content,
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
          initialEngine: this.autoModeEngine as AutoModeEngineKodaX,
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
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[real-session ${sid}] auto-mode bootstrap failed: ${message}`);
        // F030 review HIGH#2: 失败 fallback 不是 fail-open——broker (F029) 把 auto 当
        // accept-edits 处理，bash/dangerous 仍弹窗。但用户以为"Auto"全自动跑，应当显著
        // 告知 guardrail 失效。多重信号：
        //   1. session_error 进入 conversation stream（持久化、不会闪走）
        //   2. 强制 engine 降到 'rules' 让 status bar 立即显示 "Auto · rules"（视觉提示）
        //   3. 文案明确告知失败原因 + 当前回退行为，让用户知道"是 accept-edits 不是 llm guardrail"
        this.emit({
          kind: 'session_error',
          sessionId: sid,
          error:
            `Auto mode guardrail failed to initialize: ${message}. ` +
            `Session continues with accept-edits behavior (no LLM/rules classifier). ` +
            `Check ~/.kodax/auto-rules.jsonc syntax or pick a different mode.`,
        });
        if (this.autoModeEngine !== 'rules') {
          this.autoModeEngine = 'rules';
          this.emit({
            kind: 'auto_engine_change',
            sessionId: sid,
            engine: 'rules',
          });
        }
      }
    }

    const options: KodaXOptions = {
      provider: this.provider,
      reasoningMode: this.reasoningMode,
      // SDK 0.7.42 wired (P0): /model + /thinking 设置在下一 turn 生效
      ...(this.model !== undefined ? { model: this.model } : {}),
      ...(this.thinking !== undefined ? { thinking: this.thinking } : {}),
      events,
      abortSignal: signal,
      // scope: 'user' 让 SDK FileSessionStorage 把 session 当成用户对话面板的
      // first-class session 落盘（默认可能是 'managed-task-worker'，那种不在
      // listSessions({scope:'user'}) 的结果里 — sidebar 重启后看不到）。
      session: { id: sid, scope: 'user' },
      context: {
        cwd: this.projectRoot,
        // gitRoot 用 projectRoot——Space 不再单独求 git root，KodaX 自己会处理边界
        gitRoot: this.projectRoot,
        executionCwd: this.projectRoot,
        planModeBlockCheck,
      },
      guardrails,
    };

    try {
      await sdk.runKodaX(options, prompt);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.emit({ kind: 'session_error', sessionId: sid, error: 'cancelled' });
      } else if (!signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit({ kind: 'session_error', sessionId: sid, error: message });
      }
    }
  }
}
