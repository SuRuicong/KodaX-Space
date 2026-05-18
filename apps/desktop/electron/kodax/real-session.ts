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

import { runKodaX } from '@kodax-ai/kodax/coding';
import type { KodaXOptions, KodaXEvents } from '@kodax-ai/kodax/coding';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import type {
  ManagedSession,
  PermissionRequestFn,
  SessionCreateOptions,
} from './session-adapter.js';

type SpaceReasoning = 'off' | 'auto' | 'quick' | 'balanced' | 'deep';

// Plan-mode 阻止的工具集 — 任何"会改世界 / 触发外部副作用 / 启动可写子进程"的工具。
// KodaX context.planModeBlockCheck 返回非 null reason 则 KodaX 立刻 deny 这次调用。
//
// 来源：c:/Works/GitWorks/KodaX-author/KodaX/packages/coding/src/tools/*.ts 完整 tool 名表。
// 分类：
//   - 文件写入：edit / write / multi_edit / insert_after_anchor / undo
//   - 外部副作用：bash / web_fetch / web_search（web_search 可能调付费 API + 数据外泄）
//   - MCP 任意调用：mcp_call（mcp_search/describe/read_resource/get_prompt 是只读，放行）
//   - Worktree 操作：worktree_create / worktree_remove
//   - 自构造（写 ~/.kodax/constructed/）：scaffold_agent / scaffold_tool / activate_agent /
//     activate_tool / stage_agent_construction / stage_construction（validate_* 是只读）
//   - Child 派发：dispatch_child_task（child 可能 readOnly:false，里面写文件；plan-mode
//     不允许 fanout 出可写 child）
//   - 协调器：send_message / task_stop（对已跑 child 发指令；plan-mode 不应当干预执行）
//
// 不在此表 = plan-mode 放行（read/grep/glob/code_search/semantic_lookup/symbol_context/
// module_context/process_context/impact_estimate/changed_scope/changed_diff*/repo_overview/
// ask_user_question/todo_*/exit_plan_mode/emit_managed_protocol/mcp_search/mcp_describe/
// mcp_read_resource/mcp_get_prompt/validate_*）。
//
// 设计权衡 — blocklist vs allowlist：
//   选 blocklist 因为 KodaX 新增 tool 时漏加 allowlist 会让 plan-mode "锁死所有工具"
//   把用户卡住；漏加 blocklist 会让某个新 tool 在 plan-mode 跑（功能影响 < 锁死）。
//   每次 KodaX 升级 SDK 都 review tool 表对照本 set —— 见 docs/ADR/ADR-005-plan-mode-policy.md
//   （TODO 补 ADR）。
const PLAN_MODE_BLOCKED_TOOLS = new Set([
  // 文件写入
  'edit',
  'write',
  'multi_edit',
  'str_replace',
  'insert_after_anchor',
  'undo',
  // 外部副作用 / shell
  'bash',
  'web_fetch',
  'web_search',
  // MCP 任意调用
  'mcp_call',
  // Worktree
  'worktree_create',
  'worktree_remove',
  // 自构造（写盘 + 改 agent/tool 注册表）
  'scaffold_agent',
  'scaffold_tool',
  'activate_agent',
  'activate_tool',
  'stage_agent_construction',
  'stage_construction',
  // Child 派发 + 协调器
  'dispatch_child_task',
  'send_message',
  'task_stop',
]);

export class RealKodaXSession implements ManagedSession {
  readonly sessionId: string;
  readonly projectRoot: string;
  provider: string;
  reasoningMode: SpaceReasoning;
  permissionMode: ManagedSession['permissionMode'];
  /** FEATURE_029：auto mode 子档；非 auto mode 时持有也无害（下次切 auto 时生效）。*/
  autoModeEngine: ManagedSession['autoModeEngine'];
  readonly createdAt: number;
  lastActivityAt: number;
  title: string | undefined = undefined;

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

  private async runRealStream(prompt: string, signal: AbortSignal): Promise<void> {
    const sid = this.sessionId;

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
      if (!PLAN_MODE_BLOCKED_TOOLS.has(tool)) return null;
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

    const options: KodaXOptions = {
      provider: this.provider,
      reasoningMode: this.reasoningMode,
      events,
      abortSignal: signal,
      session: { id: sid },
      context: {
        cwd: this.projectRoot,
        // gitRoot 用 projectRoot——Space 不再单独求 git root，KodaX 自己会处理边界
        gitRoot: this.projectRoot,
        executionCwd: this.projectRoot,
        planModeBlockCheck,
      },
    };

    try {
      await runKodaX(options, prompt);
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
