// WorkflowController (F060) — Space main 侧的工作流进程事件管线。
//
// 对标 KodaX SDK FEATURE_229(0.7.50):工作流进度是可订阅的一等进程。本控制器:
//   1. 订阅 SDK 进程级 run manager 的 WorkflowProcessEvent 流(getDefaultWorkflowRunManager)
//   2. 给每个 snapshot 附上 host 归属(runId → {sessionId, surface})
//   3. 转发到 renderer(pushToRenderer('workflow.event', ...))
//   4. 给 IPC handler 提供 list/get(切 session 时播种)
//
// **Space 零编排**:只搬运 SDK 的 snapshot,绝不折叠底层 WorkflowEvent、绝不自己跑工作流。
//
// 归属 interim(SDK 缺口,已开需求):snapshot 不带 host 归属字段,Space 在 main 侧维护一张
// 自持久化的 runId→{sessionId,surface} 映射(F063/F064 启动时 registerOrigin)。落
// ~/.kodax/space/workflow-origins.json,进程重启仍可归属。SDK 补 origin 字段后此映射可下线。

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { WorkflowRunT, WorkflowEventPayload } from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from './data-paths.js';
import { pushToRenderer } from '../ipc/push.js';
import { artifactStore } from '../artifact/store.js';
import { detectArtifactKind } from '../artifact/workflow-artifact-bridge.js';

// ---- SDK 形状(只取本控制器用到的子集,避免硬依赖 SDK 类型导出) ----
interface SdkProcessSnapshot {
  readonly runId: string;
  readonly hostMetadata?: Record<string, string>;
  readonly [k: string]: unknown;
}
type SdkProcessEvent = {
  readonly type: 'workflow_started' | 'workflow_updated' | 'workflow_finished';
  readonly snapshot: SdkProcessSnapshot;
  readonly message?: string;
};
export interface WorkflowRunManagerLike {
  subscribeWorkflowProcess(listener: (event: SdkProcessEvent) => void): () => void;
  getWorkflowProcessSnapshot(runId: string): SdkProcessSnapshot | undefined;
  listWorkflowProcessSnapshots(options?: {
    activeOnly?: boolean;
    limit?: number;
  }): readonly SdkProcessSnapshot[];
  /** F063 启动:把已解析的 module + options 提交到进程管理器,事件经订阅回流。可能异步。 */
  startFromOptions(input: Record<string, unknown>): unknown | Promise<unknown>;
}

// ---- F063 库 / 启动 类型 ----
export interface WorkflowMetaLite {
  readonly name: string;
  readonly description: string;
  readonly plannedAgents?: number;
  readonly maxAgents?: number;
  readonly readOnly?: boolean;
  // mutable array：与 IPC 出参 schema 推断的 string[] 对齐（SDK 给 readonly，cast 时收敛）。
  readonly phases?: string[];
}
export interface SavedWorkflowLite {
  readonly name: string;
  readonly path: string;
  readonly source?: string;
  readonly execution?: string;
}
export interface WorkflowPatternLite {
  readonly name: string;
  readonly pattern: string;
  readonly description: string;
}
export interface WorkflowLibrary {
  readonly builtin: WorkflowMetaLite[];
  readonly patterns: WorkflowPatternLite[];
  readonly saved: SavedWorkflowLite[];
}
export interface WorkflowPreflight {
  readonly ok: boolean;
  readonly issues: { readonly severity?: string; readonly message: string }[];
}
/** 发起方 session 的精简字段——足够给 workflow 子 agent 建 KodaXOptions。 */
export interface LaunchSession {
  readonly sessionId: string;
  readonly surface: 'code' | 'partner';
  readonly provider: string;
  readonly model?: string;
  readonly reasoningMode: string;
  readonly agentMode: string;
  readonly projectRoot: string;
}
export interface LaunchInput {
  /** built-in name 或 saved 文件路径。 */
  readonly target: string;
  readonly source: 'builtin' | 'saved';
  readonly args?: unknown;
  readonly session: LaunchSession;
}
export type WorkflowStartResult = { readonly runId: string } | { readonly error: string };
export type WorkflowSavedResult =
  | { readonly name: string; readonly path: string; readonly previousPath?: string }
  | { readonly error: string };

// F062 run 生命周期控制——SDK createWorkflowLifecycleController 的子集(只取本控制器用到的)。
export interface WorkflowRetentionResult {
  readonly deleted: number;
  readonly protectedRuns: number;
  readonly candidates: readonly string[];
  readonly dryRun: boolean;
}
export interface WorkflowLifecycleLike {
  stopWorkflow(runId: string, reason?: string): Promise<boolean>;
  pauseWorkflow(runId: string): Promise<boolean>;
  resumeWorkflow(runId: string): Promise<boolean>;
  renameWorkflowRun(runId: string, displayName: string): Promise<boolean>;
  deleteWorkflowRun(runId: string, options?: { force?: boolean }): Promise<boolean>;
  pruneWorkflowRuns(options: {
    keep?: number;
    olderThanDays?: number;
    dryRun?: boolean;
  }): Promise<WorkflowRetentionResult>;
  // F066 结果 / artifact 读取。
  readWorkflowResult(runId: string): Promise<string | undefined>;
  readWorkflowArtifact(runId: string, name: string): Promise<unknown | undefined>;
}

export interface WorkflowOrigin {
  readonly sessionId?: string;
  readonly surface?: 'code' | 'partner';
}

type PushFn = (payload: WorkflowEventPayload) => void;

// 映射上限——防止长跑进程里 origins 无界增长(终态 run 的归属不再变,留最近 N 条即可)。
const MAX_ORIGINS = 500;

function nonnegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

interface OriginsFile {
  readonly version: 1;
  readonly origins: Record<string, WorkflowOrigin>;
}

/**
 * 默认 push:走 ipc/push 的 pushToRenderer。测试注入 no-op / 捕获器。
 */
const defaultPush: PushFn = (payload) => pushToRenderer('workflow.event', payload);

export class WorkflowController {
  private manager: WorkflowRunManagerLike | null = null;
  /** F062 run 生命周期控制器(stop/pause/resume/rename/delete/prune)。 */
  private lifecycle: WorkflowLifecycleLike | null = null;
  private unsubscribe: (() => void) | null = null;
  /** 插入序的 runId→origin。Map 迭代序 = 插入序,用于 MAX_ORIGINS LRU 淘汰。*/
  private origins = new Map<string, WorkflowOrigin>();
  /** F066:已桥接过 artifact 的 run（防 workflow_finished 重发导致重复桥接）。*/
  private bridgedRuns = new Set<string>();
  private loaded = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly push: PushFn = defaultPush,
    private readonly originsFile: string = path.join(getSpaceDataDir(), 'workflow-origins.json'),
    /** Space 自有 run base dir——F063 启动 run 与 F062 durable 控制(delete/prune)共用。 */
    private readonly runBaseDir: string = path.join(getSpaceDataDir(), 'workflow-runs'),
  ) {}

  /**
   * 初始化:加载持久化归属 + 订阅 run manager 的进程事件流 + 建生命周期控制器。
   * manager/lifecycle 缺省 lazy-load 真 SDK(与 AMAW/REPL 共享进程单例);测试注入 fake。
   * 注:仅当 manager 未注入(生产路径)时才自动建真 lifecycle——避免拿 fake manager 去
   * 实例化真 SDK 控制器。测试需要控制能力时显式注入 lifecycle。
   * 幂等:重复 init 先解订阅旧的。
   */
  async init(manager?: WorkflowRunManagerLike, lifecycle?: WorkflowLifecycleLike): Promise<void> {
    await this.loadOrigins();
    this.unsubscribe?.();
    const managerInjected = manager !== undefined;
    this.manager = manager ?? (await loadDefaultManager());
    // 先重置——re-init 换 manager 时别留着绑在旧 manager 上的 lifecycle。
    this.lifecycle = null;
    if (lifecycle !== undefined) {
      this.lifecycle = lifecycle;
    } else if (!managerInjected && this.manager) {
      this.lifecycle = await loadLifecycle(this.manager, this.runBaseDir);
    }
    if (!this.manager) return; // SDK 不可用(理论上不会)——降级:无实时流,list/get 返回空
    this.unsubscribe = this.manager.subscribeWorkflowProcess((event) => this.onEvent(event));
  }

  // ---- F062 run 生命周期控制(委托 lifecycle controller;未就绪一律安全降级)----

  /** 停止进行中的 run(子 agent 标 cancelled / never-started 标 skipped)。 */
  async stop(runId: string, reason?: string): Promise<boolean> {
    const pushed = this.pushStopFallback(runId, reason);
    const lifecycleStop = this.lifecycle?.stopWorkflow(runId, reason);
    if (!lifecycleStop) return pushed;
    if (pushed) {
      void lifecycleStop.catch((err) => {
        console.warn('[workflow] stopWorkflow failed after local fallback:',
          err instanceof Error ? err.message : err);
      });
      return true;
    }
    const ok = await lifecycleStop;
    if (ok) this.pushStopFallback(runId, reason);
    return ok;
  }

  private pushStopFallback(runId: string, reason?: string): boolean {
    const snapshot = this.manager?.getWorkflowProcessSnapshot(runId);
    if (!snapshot) return false;
    const status = (snapshot as { status?: unknown }).status;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') return false;
    const origin = this.originFromSnapshot(snapshot);
    this.push({
      type: 'workflow_finished',
      snapshot: this.toCancelledSnapshot(snapshot, reason),
      message: reason ?? 'workflow stopped',
      ...(origin.sessionId !== undefined ? { sessionId: origin.sessionId } : {}),
      ...(origin.surface !== undefined ? { surface: origin.surface } : {}),
    });
    return true;
  }

  private toCancelledSnapshot(
    snapshot: SdkProcessSnapshot,
    reason?: string,
  ): WorkflowEventPayload['snapshot'] {
    const raw = snapshot as Record<string, unknown>;
    const now = new Date().toISOString();
    const items = Array.isArray(raw.items)
      ? raw.items.map((item) => this.toSettledWorkflowItem(item, now))
      : [];
    return {
      ...(snapshot as unknown as WorkflowEventPayload['snapshot']),
      status: 'cancelled',
      updatedAt: now,
      items: items as WorkflowEventPayload['snapshot']['items'],
      counts: this.countWorkflowItems(items, raw.counts),
      progress: this.cancelledProgress(raw.progress),
      ...(reason ? { latestMessage: reason } : {}),
    };
  }

  private toSettledWorkflowItem(item: unknown, endedAt: string): unknown {
    if (!item || typeof item !== 'object') return item;
    const rec = item as Record<string, unknown>;
    if (rec.status === 'running') {
      return { ...rec, status: 'cancelled', endedAt: typeof rec.endedAt === 'string' ? rec.endedAt : endedAt };
    }
    if (rec.status === 'pending') {
      return { ...rec, status: 'skipped', endedAt: typeof rec.endedAt === 'string' ? rec.endedAt : endedAt };
    }
    return item;
  }

  private countWorkflowItems(
    items: readonly unknown[],
    fallback: unknown,
  ): WorkflowEventPayload['snapshot']['counts'] {
    const counts: WorkflowEventPayload['snapshot']['counts'] = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      skipped: 0,
    };
    for (const item of items) {
      const status = item && typeof item === 'object' ? (item as { status?: unknown }).status : undefined;
      if (
        status === 'pending' ||
        status === 'running' ||
        status === 'completed' ||
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'skipped'
      ) {
        counts[status] += 1;
      }
    }
    if (Object.values(counts).some((n) => n > 0)) return counts;
    const f = fallback && typeof fallback === 'object' ? (fallback as Record<string, unknown>) : {};
    return {
      pending: nonnegativeInt(f.pending),
      running: nonnegativeInt(f.running),
      completed: nonnegativeInt(f.completed),
      failed: nonnegativeInt(f.failed),
      cancelled: nonnegativeInt(f.cancelled),
      skipped: nonnegativeInt(f.skipped),
    };
  }

  private cancelledProgress(progress: unknown): WorkflowEventPayload['snapshot']['progress'] {
    const p = progress && typeof progress === 'object' ? (progress as Record<string, unknown>) : {};
    const activeAgents = nonnegativeInt(p.activeAgents);
    return {
      spawnedAgents: nonnegativeInt(p.spawnedAgents),
      finishedAgents: nonnegativeInt(p.finishedAgents) + activeAgents,
      activeAgents: 0,
      failedAgents: nonnegativeInt(p.failedAgents),
      stoppedAgents: nonnegativeInt(p.stoppedAgents) + activeAgents,
      ...(typeof p.agentCap === 'number' && Number.isFinite(p.agentCap) && p.agentCap >= 0
        ? { agentCap: Math.floor(p.agentCap) }
        : {}),
      ...(typeof p.plannedItems === 'number' && Number.isFinite(p.plannedItems) && p.plannedItems >= 0
        ? { plannedItems: Math.floor(p.plannedItems) }
        : {}),
    };
  }

  /** 暂停进行中的 run。 */
  async pause(runId: string): Promise<boolean> {
    return (await this.lifecycle?.pauseWorkflow(runId)) ?? false;
  }

  /** 恢复已暂停的 run。 */
  async resume(runId: string): Promise<boolean> {
    return (await this.lifecycle?.resumeWorkflow(runId)) ?? false;
  }

  /** 改 run 显示名(不改 runId)。 */
  async rename(runId: string, displayName: string): Promise<boolean> {
    return (await this.lifecycle?.renameWorkflowRun(runId, displayName)) ?? false;
  }

  /** 删终态 run(活跃 run 被 SDK 拒,除非 force)。删后清本地归属。 */
  async deleteRun(runId: string, force?: boolean): Promise<boolean> {
    const ok = (await this.lifecycle?.deleteWorkflowRun(runId, force ? { force } : undefined)) ?? false;
    if (ok) {
      this.bridgedRuns.delete(runId);
      if (this.origins.delete(runId)) void this.persistOrigins();
    }
    return ok;
  }

  /** 清理终态 run(保留最近 keep / olderThanDays 之外)。 */
  async prune(options: {
    keep?: number;
    olderThanDays?: number;
    dryRun?: boolean;
  }): Promise<WorkflowRetentionResult> {
    const empty: WorkflowRetentionResult = {
      deleted: 0,
      protectedRuns: 0,
      candidates: [],
      dryRun: options.dryRun ?? false,
    };
    return (await this.lifecycle?.pruneWorkflowRuns(options)) ?? empty;
  }

  // ---- F063 库 / 启动 / preflight ----

  /** 列出可启动的工作流:built-in(内置)+ saved(用户/项目 ~/.kodax/workflows)。*/
  async listLibrary(projectRoot?: string): Promise<WorkflowLibrary> {
    const sdk = await loadCodingSdk();
    if (!sdk) return { builtin: [], patterns: [], saved: [] };
    let builtin: WorkflowMetaLite[] = [];
    let patterns: WorkflowPatternLite[] = [];
    let saved: SavedWorkflowLite[] = [];
    try {
      builtin = [...(sdk.listBuiltinWorkflows?.() ?? [])] as WorkflowMetaLite[];
    } catch (err) {
      console.warn('[WorkflowController] listBuiltinWorkflows:', err instanceof Error ? err.message : err);
    }
    try {
      patterns = [...(sdk.listWorkflowPatternTemplates?.() ?? [])] as WorkflowPatternLite[];
    } catch (err) {
      console.warn('[WorkflowController] listWorkflowPatternTemplates:', err instanceof Error ? err.message : err);
    }
    try {
      const refs = (await sdk.discoverSavedWorkflows?.(savedWorkflowDirs(projectRoot))) ?? [];
      saved = refs.map((r) => ({
        name: r.name,
        path: r.path,
        source: r.source,
        ...(r.execution !== undefined ? { execution: r.execution } : {}),
      }));
    } catch (err) {
      console.warn('[WorkflowController] discoverSavedWorkflows:', err instanceof Error ? err.message : err);
    }
    return { builtin, patterns, saved };
  }

  /** 预检 saved 工作流 capsule（环境/工具/MCP/skills 需求）。built-in 视为可信、直接 ok。*/
  async preflightSaved(filePath: string): Promise<WorkflowPreflight> {
    const sdk = await loadCodingSdk();
    // fail-safe：预检能力缺失时不静默放行（否则用户以为"无问题"却跑了未校验的可执行 capsule）。
    // 回一条 warning issue → renderer 弹确认，让用户知情后再决定。
    if (!sdk?.loadSavedWorkflowCapsule || !sdk?.preflightWorkflowCapsule) {
      return { ok: false, issues: [{ severity: 'warning', message: '预检不可用（SDK 能力缺失），未校验' }] };
    }
    try {
      const capsule = await sdk.loadSavedWorkflowCapsule(filePath);
      const res = await preflightCapsule(sdk, capsule);
      return {
        ok: res.ok,
        issues: (res.issues ?? []).map((i) => ({ severity: i.severity, message: i.message })),
      };
    } catch (err) {
      return { ok: false, issues: [{ message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  /**
   * 从一个 session 发起工作流:解析 module → 用 session 字段建精简 KodaXOptions →
   * manager.startFromOptions → 登记归属。事件经 F060 订阅自然回流到 renderer。
   */
  async start(input: LaunchInput): Promise<{ runId: string } | { error: string }> {
    const sdk = await loadCodingSdk();
    if (!sdk || !this.manager) return { error: 'workflow runtime unavailable' };
    let module: unknown;
    try {
      module =
        input.source === 'builtin'
          ? sdk.getBuiltinWorkflow?.(input.target)
          : await sdk.loadSavedWorkflow?.(input.target);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    if (!module) return { error: `workflow not found: ${input.target}` };

    const s = input.session;
    // 精简 options——workflow 子 agent 只需 provider/model/reasoning/agentMode/context;
    // 不带主对话的 events/storage/compact 等 per-run 状态(那些是 real-session 对话回路专用)。
    const options: Record<string, unknown> = {
      provider: s.provider,
      reasoningMode: s.reasoningMode,
      agentMode: s.agentMode,
      ...(s.model ? { model: s.model } : {}),
      context: { gitRoot: s.projectRoot, executionCwd: s.projectRoot },
    };
    const runId = `wf_${randomUUID()}`;
    const runDir = path.join(this.runBaseDir, runId);
    const meta = (module as { meta?: { name?: string } }).meta;
    try {
      // await:startFromOptions 可能异步（建 run 目录/注册进程/spawn）。不 await 会让
      // 异步错误变 unhandled rejection，且 registerOrigin 抢跑在启动确认之前（ghost run）。
      await this.manager.startFromOptions({
        module,
        args: input.args ?? {},
        // workflow 子 agent 用精简 options（无 session block）——run 是**短命**的，自带
        // run 目录（run.json/events.jsonl/artifacts），不写对话 lineage。刻意设计。
        options,
        runId,
        runDir,
        processMetadata: { displayName: meta?.name, source: 'sdk', hostMetadata: this.hostMetadata(s) },
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    this.registerOrigin(runId, { sessionId: s.sessionId, surface: s.surface });
    return { runId };
  }

  // ---- F066 结果 / artifact 读取 ----

  /** 读 run 的最终 displayable result（SDK 已 lint 过非空）。无 lifecycle / 不存在 → undefined。 */
  async createGeneratedWorkflow(request: string, session: LaunchSession): Promise<WorkflowStartResult> {
    const sdk = await loadCodingSdk();
    if (!sdk?.generateWorkflowFromOptions) return { error: 'workflow generation unavailable' };
    let generated: WorkflowGenerationResultLite;
    try {
      generated = await sdk.generateWorkflowFromOptions({
        request,
        options: this.launchOptions(session),
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    if (generated.kind === 'declined') {
      return { error: `workflow generation declined: ${generated.reason}` };
    }
    return this.startWorkflowModule({
      module: generated.module,
      args: { request },
      session,
      source: 'command',
      scriptSnapshot: generated.scriptSnapshot,
      processMetadata: {
        displayName: generated.manifest.name,
        goal: request,
      },
    });
  }

  async rerunGeneratedWorkflow(
    runId: string,
    args: unknown,
    session: LaunchSession,
  ): Promise<WorkflowStartResult> {
    const sdk = await loadCodingSdk();
    if (!sdk?.loadGeneratedWorkflowFromRun) return { error: 'workflow rerun unavailable' };
    let loaded: LoadedGeneratedWorkflowLite;
    try {
      loaded = await sdk.loadGeneratedWorkflowFromRun({ runDir: path.join(this.runBaseDir, runId) });
      if (sdk.preflightWorkflowCapsule) {
        const preflight = await preflightCapsule(sdk, loaded.capsule);
        if (!preflight.ok) return { error: formatPreflightIssues(preflight) };
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    const scriptSnapshot = scriptSnapshotFromCapsule(loaded.capsule);
    return this.startWorkflowModule({
      module: loaded.module,
      args,
      session,
      source: 'command',
      ...(scriptSnapshot ? { scriptSnapshot } : {}),
      processMetadata: {
        displayName: workflowNameFromModule(loaded.module),
        sourceRunId: runId,
      },
    });
  }

  async saveGeneratedWorkflowFromRun(
    runId: string,
    name: string,
    projectRoot: string,
  ): Promise<WorkflowSavedResult> {
    const sdk = await loadCodingSdk();
    if (!sdk?.saveGeneratedWorkflowFromRun) return { error: 'workflow save unavailable' };
    try {
      const ref = await sdk.saveGeneratedWorkflowFromRun({
        runDir: path.join(this.runBaseDir, runId),
        targetDir: savedWorkflowDirs(projectRoot).project ?? path.join(projectRoot, '.kodax', 'workflows'),
        name,
      });
      return { name: ref.name, path: ref.path };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async renameSavedWorkflow(
    name: string,
    newName: string,
    projectRoot: string,
    source?: string,
  ): Promise<WorkflowSavedResult> {
    const sdk = await loadCodingSdk();
    if (!sdk?.renameSavedWorkflow) return { error: 'saved workflow rename unavailable' };
    try {
      const ref = await sdk.renameSavedWorkflow({
        dirs: savedWorkflowDirs(projectRoot),
        name,
        newName,
        ...(source ? { source } : {}),
      });
      return { name: ref.name, path: ref.path };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async deleteSavedWorkflow(name: string, projectRoot: string, source?: string): Promise<WorkflowSavedResult> {
    const sdk = await loadCodingSdk();
    if (!sdk?.deleteSavedWorkflow) return { error: 'saved workflow delete unavailable' };
    try {
      const ref = await sdk.deleteSavedWorkflow({
        dirs: savedWorkflowDirs(projectRoot),
        name,
        ...(source ? { source } : {}),
      });
      return { name: ref.name, path: ref.path };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async reviseWorkflow(input: {
    readonly target: string;
    readonly request: string;
    readonly replace?: boolean;
    readonly session: LaunchSession;
    readonly saved?: SavedWorkflowLite;
  }): Promise<WorkflowSavedResult> {
    if (input.replace && !input.saved) {
      return { error: 'revise --replace requires a saved workflow name target' };
    }
    const sdk = await loadCodingSdk();
    if (!sdk?.generateWorkflowFromOptions) return { error: 'workflow revision unavailable' };
    let capsule: WorkflowCapsuleLite;
    try {
      if (input.saved) {
        if (input.saved.execution !== undefined && input.saved.execution !== 'capability-generated') {
          return { error: 'only generated workflow capsules can be revised' };
        }
        if (!sdk.loadSavedWorkflowCapsule) return { error: 'saved workflow capsule loading unavailable' };
        capsule = asWorkflowCapsule(await sdk.loadSavedWorkflowCapsule(input.saved.path));
      } else {
        if (!sdk.loadGeneratedWorkflowFromRun) return { error: 'generated run loading unavailable' };
        const loaded = await sdk.loadGeneratedWorkflowFromRun({
          runDir: path.join(this.runBaseDir, input.target),
        });
        capsule = asWorkflowCapsule(loaded.capsule);
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    const revisionRequest = buildWorkflowRevisionRequest({
      target: input.target,
      capsule,
      changeRequest: input.request,
    });
    let generated: WorkflowGenerationResultLite;
    try {
      generated = await sdk.generateWorkflowFromOptions({
        request: revisionRequest,
        options: this.launchOptions(input.session),
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    if (generated.kind === 'declined') {
      return { error: `workflow revision declined: ${generated.reason}` };
    }

    const dirs = savedWorkflowDirs(input.session.projectRoot);
    const generatedManifest = generated.manifest;
    const replacingName = input.replace ? input.saved?.name : undefined;
    const savedName = replacingName ?? await nextRevisionWorkflowName(sdk, dirs, generatedManifest.name);
    const manifest = savedName === generatedManifest.name
      ? generatedManifest
      : { ...generatedManifest, name: savedName };
    const provenance = buildRevisionProvenance({
      capsule,
      target: input.target,
      savedName: input.saved?.name,
      ...(replacingName ? { replacesWorkflowName: replacingName } : {}),
    });
    const saveInput = {
      name: savedName,
      manifest,
      source: generated.source,
      intent: {
        taskClass: firstPatternName(manifest) ?? manifest.name,
        originalRequest: input.request,
        reusableFor: [manifest.description],
      },
      ...(capsule.inputs !== undefined ? { inputs: capsule.inputs } : {}),
      ...(capsule.requires !== undefined ? { requires: capsule.requires } : {}),
      provenance,
    };

    try {
      if (input.replace && input.saved) {
        if (!sdk.replaceSavedWorkflow) return { error: 'saved workflow replace unavailable' };
        const ref = await sdk.replaceSavedWorkflow({
          ...saveInput,
          dirs,
          ...(input.saved.source ? { savedSource: input.saved.source } : {}),
        });
        return { name: ref.name, path: ref.path, previousPath: ref.previousPath };
      }
      if (!sdk.saveGeneratedWorkflow) return { error: 'workflow revision save unavailable' };
      const ref = await sdk.saveGeneratedWorkflow({
        ...saveInput,
        dir: dirs.project ?? path.join(input.session.projectRoot, '.kodax', 'workflows'),
      });
      return { name: ref.name, path: ref.path };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async readResult(runId: string): Promise<string | undefined> {
    return this.lifecycle?.readWorkflowResult(runId);
  }

  /** 读 run 的某个 artifact 内容（unknown JSON 值）。 */
  async readArtifact(runId: string, name: string): Promise<unknown | undefined> {
    return this.lifecycle?.readWorkflowArtifact(runId, name);
  }

  /**
   * F063/F064 在启动 run 时登记其发起方,供归属。立即 push 一条不发生——只记映射;
   * 后续该 run 的事件/list 自动带上 sessionId/surface。持久化(best-effort)。
   */
  registerOrigin(runId: string, origin: WorkflowOrigin): void {
    if (!runId) return;
    // 重新插入到末尾(刷新 LRU 新近度)
    this.origins.delete(runId);
    this.origins.set(runId, origin);
    while (this.origins.size > MAX_ORIGINS) {
      const oldest = this.origins.keys().next().value;
      if (oldest === undefined) break;
      this.origins.delete(oldest);
    }
    void this.persistOrigins();
  }

  /** 切 session 时播种:列出已知 run(可按 sessionId 过滤),带归属。*/
  list(sessionId?: string): WorkflowRunT[] {
    if (!this.manager) return [];
    // 传 limit 上限——SDK 默认返回进程内全部 snapshot,无界 list 会撑大 IPC payload。
    // 与 MAX_ORIGINS / renderer 侧 MAX_WORKFLOW_RUNS 对齐。
    const snapshots = this.manager.listWorkflowProcessSnapshots({ limit: MAX_ORIGINS });
    const runs = snapshots.map((s) => this.attribute(s));
    if (sessionId === undefined) return runs;
    return runs.filter((r) => r.sessionId === sessionId);
  }

  /** 按 runId 取单个 snapshot(带归属);不存在返回 null。*/
  get(runId: string): WorkflowRunT | null {
    if (!this.manager) return null;
    const snap = this.manager.getWorkflowProcessSnapshot(runId);
    return snap ? this.attribute(snap) : null;
  }

  /** 等待 in-flight 归属写盘完成(测试 + 优雅关闭用)。*/
  async flush(): Promise<void> {
    await this.writeLock;
  }

  /** 关闭:解订阅。重置 loaded 让后续 re-init 能重新从盘加载归属(外部进程可能改过)。*/
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.manager = null;
    this.lifecycle = null;
    this.loaded = false;
  }

  // ---- 内部 ----

  private launchOptions(s: LaunchSession): Record<string, unknown> {
    return {
      provider: s.provider,
      reasoningMode: s.reasoningMode,
      agentMode: s.agentMode,
      ...(s.model ? { model: s.model } : {}),
      context: { gitRoot: s.projectRoot, executionCwd: s.projectRoot },
    };
  }

  private hostMetadata(s: LaunchSession): Record<string, string> {
    return {
      host: 'kodax-space',
      sessionId: s.sessionId,
      surface: s.surface,
    };
  }

  private async startWorkflowModule(input: {
    readonly module: unknown;
    readonly args: unknown;
    readonly session: LaunchSession;
    readonly source: string;
    readonly scriptSnapshot?: WorkflowScriptSnapshotLite;
    readonly processMetadata?: Record<string, unknown>;
  }): Promise<WorkflowStartResult> {
    if (!this.manager) return { error: 'workflow runtime unavailable' };
    const runId = `wf_${randomUUID()}`;
    const runDir = path.join(this.runBaseDir, runId);
    const displayName = workflowNameFromModule(input.module);
    try {
      await this.manager.startFromOptions({
        module: input.module,
        args: input.args ?? {},
        options: this.launchOptions(input.session),
        runId,
        runDir,
        ...(input.scriptSnapshot ? { scriptSnapshot: input.scriptSnapshot } : {}),
        processMetadata: {
          displayName,
          ...input.processMetadata,
          source: input.source,
          hostMetadata: this.hostMetadata(input.session),
        },
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    this.registerOrigin(runId, {
      sessionId: input.session.sessionId,
      surface: input.session.surface,
    });
    return { runId };
  }

  private onEvent(event: SdkProcessEvent): void {
    const origin = this.originFromSnapshot(event.snapshot);
    // snapshot 原样转发;push.ts 在 IPC 边界做 zod 校验(失败则丢弃+日志),这里不重复校验。
    this.push({
      type: event.type,
      snapshot: event.snapshot as unknown as WorkflowRunT,
      ...(event.message !== undefined ? { message: event.message } : {}),
      ...(origin.sessionId !== undefined ? { sessionId: origin.sessionId } : {}),
      ...(origin.surface !== undefined ? { surface: origin.surface } : {}),
    });
    // F066:run 终态时把产出的 artifact 桥进 Space artifact 层（方案 A）。fire-and-forget + 顶层 catch。
    if (event.type === 'workflow_finished') {
      void this.bridgeArtifacts(event.snapshot, origin).catch((err) =>
        console.warn('[WorkflowController] bridgeArtifacts:', err instanceof Error ? err.message : err),
      );
    }
  }

  /**
   * F066：把 workflow run 的 artifacts 复制进 artifactStore（方案 A——统一面板，复用 F057-F059）。
   * 每个 run 仅桥接一次（防 workflow_finished 重发）。归属到发起 session；外部 run（无 sessionId）跳过。
   */
  private async bridgeArtifacts(snapshot: SdkProcessSnapshot, origin: WorkflowOrigin): Promise<void> {
    const runId = snapshot.runId;
    if (this.bridgedRuns.has(runId) || !origin.sessionId) return;
    const artifacts = (snapshot as { artifacts?: { name?: string }[] }).artifacts;
    if (!artifacts || artifacts.length === 0) return;
    // 先标记（防并发重入 + workflow_finished 重发导致重复桥接——artifactStore.upsert 无外部键去重,
    // 重桥会产生重复 artifact）。取舍:首个 artifact 读/写失败不会在 re-finish 重试(已记日志);
    // 重复 artifact 对用户更糟,故优先防重复而非失败重试。
    this.bridgedRuns.add(runId);
    // 有界 LRU:超 MAX_ORIGINS*2 淘汰最旧(Set 插入序),不 clear-all——避免清空后老 run 重发被重桥成重复。
    while (this.bridgedRuns.size > MAX_ORIGINS * 2) {
      const oldest = this.bridgedRuns.values().next().value;
      if (oldest === undefined) break;
      this.bridgedRuns.delete(oldest);
    }
    for (const a of artifacts) {
      const name = a?.name;
      if (!name) continue;
      try {
        const value = await this.readArtifact(runId, name);
        if (value === undefined) continue;
        const { kind, content } = detectArtifactKind(value);
        const wfName = typeof snapshot.workflowName === 'string' ? snapshot.workflowName : '';
        await artifactStore.upsert({
          sessionId: origin.sessionId,
          surface: origin.surface ?? 'code',
          kind,
          title: name,
          content,
          summary: `workflow ${wfName}`.trim(),
        });
        pushToRenderer('artifact.changed', { sessionId: origin.sessionId, reason: 'created' });
      } catch (err) {
        console.warn('[WorkflowController] bridge artifact failed:', name, err instanceof Error ? err.message : err);
      }
    }
  }

  private attribute(snapshot: SdkProcessSnapshot): WorkflowRunT {
    // cast 经 unknown:SDK snapshot 结构与 WorkflowRunT 一致,但带 index signature 不直接兼容。
    // 运行时正确性:list/get 出参经 IPC register 校验,push 经 push.ts 校验;drift 由 round-trip
    // 单测 + 真 SDK smoke 守(见 workflow-controller.test.ts)。
    const origin = this.originFromSnapshot(snapshot);
    return {
      ...(snapshot as unknown as WorkflowRunT),
      ...(origin.sessionId !== undefined ? { sessionId: origin.sessionId } : {}),
      ...(origin.surface !== undefined ? { surface: origin.surface } : {}),
    };
  }

  private originFromSnapshot(snapshot: SdkProcessSnapshot): WorkflowOrigin {
    const meta = snapshot.hostMetadata;
    const sessionId =
      typeof meta?.sessionId === 'string' && meta.sessionId.length > 0 ? meta.sessionId : undefined;
    const surface =
      meta?.surface === 'code' || meta?.surface === 'partner' ? meta.surface : undefined;
    if (sessionId !== undefined || surface !== undefined) {
      return {
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(surface !== undefined ? { surface } : {}),
      };
    }
    return this.origins.get(snapshot.runId) ?? {};
  }

  private async loadOrigins(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.originsFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<OriginsFile>;
      if (parsed && parsed.version === 1 && parsed.origins && typeof parsed.origins === 'object') {
        for (const [runId, origin] of Object.entries(parsed.origins)) {
          if (origin && typeof origin === 'object') {
            const o: WorkflowOrigin = {};
            const so = origin as WorkflowOrigin;
            if (typeof so.sessionId === 'string') (o as { sessionId?: string }).sessionId = so.sessionId;
            if (so.surface === 'code' || so.surface === 'partner') {
              (o as { surface?: 'code' | 'partner' }).surface = so.surface;
            }
            this.origins.set(runId, o);
          }
        }
      }
    } catch (err) {
      // ENOENT(首次)静默;其它损坏文件 → 从空开始(归属丢失只影响 UI 分面,不致命)。
      if (!(err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT')) {
        console.warn(
          '[WorkflowController] origins read failed, starting empty:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /** 序列化写盘(写锁串行化,原子 tmp→rename;Windows EEXIST/EPERM 回退 copyFile)。*/
  private async persistOrigins(): Promise<void> {
    const prev = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      const payload: OriginsFile = { version: 1, origins: Object.fromEntries(this.origins) };
      const dir = path.dirname(this.originsFile);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = `${this.originsFile}.tmp-${process.pid}`;
      await fs.writeFile(tmp, JSON.stringify(payload), { encoding: 'utf-8', mode: 0o600 });
      try {
        await fs.rename(tmp, this.originsFile);
      } catch (err) {
        const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
        if (code === 'EEXIST' || code === 'EPERM') {
          await fs.copyFile(tmp, this.originsFile);
          await fs.unlink(tmp).catch(() => {});
        } else {
          await fs.unlink(tmp).catch(() => {});
          throw err;
        }
      }
    } catch (err) {
      // 归属持久化失败不致命(下次 registerOrigin 再试;最坏重启后该 run 归属丢)。
      console.warn(
        '[WorkflowController] origins persist failed:',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      release();
    }
  }
}

// F063 用到的 SDK coding 子集(库/启动/preflight)。lazy-load 一次缓存。
interface WorkflowScriptManifestLite {
  readonly name: string;
  readonly description: string;
  readonly patterns?: readonly string[];
  readonly mayUseWorktree?: boolean;
  readonly [key: string]: unknown;
}
interface WorkflowScriptSnapshotLite {
  readonly manifest: WorkflowScriptManifestLite;
  readonly source: string;
}
interface WorkflowCapsuleLite {
  readonly manifest: WorkflowScriptManifestLite;
  readonly source: string;
  readonly inputs?: unknown;
  readonly requires?: unknown;
  readonly provenance?: {
    readonly fromRunId?: string;
    readonly fromWorkflowName?: string;
    readonly revisionOf?: string;
    readonly replacesWorkflowName?: string;
    readonly createdAt?: string;
    readonly kodaxVersion?: string;
  };
}
interface LoadedGeneratedWorkflowLite {
  readonly capsule: WorkflowCapsuleLite;
  readonly module: unknown;
}
type WorkflowGenerationResultLite =
  | { readonly kind: 'declined'; readonly reason: string; readonly rawText?: string }
  | {
      readonly kind: 'generated';
      readonly manifest: WorkflowScriptManifestLite;
      readonly source: string;
      readonly module: unknown;
      readonly scriptSnapshot: WorkflowScriptSnapshotLite;
      readonly approvalSummary?: string;
      readonly rawText?: string;
    };
interface SavedWorkflowDirsLite {
  readonly personal: string;
  readonly project?: string;
}

interface CodingSdkSubset {
  listBuiltinWorkflows?: () => readonly WorkflowMetaLite[];
  listWorkflowPatternTemplates?: () => readonly WorkflowPatternLite[];
  getBuiltinWorkflow?: (name: string) => unknown;
  discoverSavedWorkflows?: (dirs: {
    personal?: string;
    project?: string;
  }) => Promise<readonly SavedWorkflowLite[]>;
  loadSavedWorkflow?: (filePath: string) => Promise<unknown>;
  loadSavedWorkflowCapsule?: (filePath: string) => Promise<unknown>;
  preflightWorkflowCapsule?: (capsuleOrInput: unknown, env?: unknown) => Promise<WorkflowPreflight> | WorkflowPreflight;
  generateWorkflowFromOptions?: (input: {
    request: string;
    options: Record<string, unknown>;
  }) => Promise<WorkflowGenerationResultLite>;
  loadGeneratedWorkflowFromRun?: (input: { runDir: string }) => Promise<LoadedGeneratedWorkflowLite>;
  saveGeneratedWorkflowFromRun?: (input: {
    runDir: string;
    targetDir: string;
    name: string;
  }) => Promise<SavedWorkflowLite>;
  renameSavedWorkflow?: (input: {
    dirs: SavedWorkflowDirsLite;
    name: string;
    newName: string;
    source?: string;
  }) => Promise<SavedWorkflowLite>;
  deleteSavedWorkflow?: (input: {
    dirs: SavedWorkflowDirsLite;
    name: string;
    source?: string;
  }) => Promise<SavedWorkflowLite>;
  saveGeneratedWorkflow?: (input: {
    dir: string;
    name: string;
    manifest: WorkflowScriptManifestLite;
    source: string;
    intent?: unknown;
    inputs?: unknown;
    requires?: unknown;
    provenance?: unknown;
  }) => Promise<SavedWorkflowLite>;
  replaceSavedWorkflow?: (input: {
    dirs: SavedWorkflowDirsLite;
    savedSource?: string;
    name: string;
    manifest: WorkflowScriptManifestLite;
    source: string;
    intent?: unknown;
    inputs?: unknown;
    requires?: unknown;
    provenance?: unknown;
  }) => Promise<SavedWorkflowLite & { previousPath: string }>;
}
let codingSdkCache: CodingSdkSubset | null = null;
export function _setCodingSdkForTesting(sdk: unknown | null): void {
  if (process.env.NODE_ENV === 'production') return;
  codingSdkCache = sdk as CodingSdkSubset | null;
}

async function loadCodingSdk(): Promise<CodingSdkSubset | null> {
  if (codingSdkCache) return codingSdkCache;
  try {
    codingSdkCache = (await import('@kodax-ai/kodax/coding')) as unknown as CodingSdkSubset;
    return codingSdkCache;
  } catch (err) {
    console.warn('[WorkflowController] failed to load SDK coding module:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** saved 工作流搜索目录:个人 ~/.kodax/workflows + 项目 <root>/.kodax/workflows。*/
function savedWorkflowDirs(projectRoot?: string): { personal: string; project?: string } {
  return {
    personal: path.join(os.homedir(), '.kodax', 'workflows'),
    ...(projectRoot ? { project: path.join(projectRoot, '.kodax', 'workflows') } : {}),
  };
}

/** Lazy-load SDK 的进程级 run manager 单例(与 AMAW/REPL 共享同一实例)。*/
function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asWorkflowCapsule(value: unknown): WorkflowCapsuleLite {
  const capsule = asRecord(value, 'workflow capsule');
  const manifest = asRecord(capsule.manifest, 'workflow capsule manifest');
  const name = manifest.name;
  const description = manifest.description;
  const source = capsule.source;
  if (typeof name !== 'string' || typeof description !== 'string' || typeof source !== 'string') {
    throw new Error('workflow capsule missing manifest.name, manifest.description, or source');
  }
  return {
    manifest: manifest as unknown as WorkflowScriptManifestLite,
    source,
    ...(capsule.inputs !== undefined ? { inputs: capsule.inputs } : {}),
    ...(capsule.requires !== undefined ? { requires: capsule.requires } : {}),
    ...(capsule.provenance && typeof capsule.provenance === 'object'
      ? { provenance: capsule.provenance as WorkflowCapsuleLite['provenance'] }
      : {}),
  };
}

function workflowNameFromModule(module: unknown): string | undefined {
  const meta = module && typeof module === 'object' ? (module as { meta?: { name?: unknown } }).meta : undefined;
  return typeof meta?.name === 'string' ? meta.name : undefined;
}

function scriptSnapshotFromCapsule(capsule: unknown): WorkflowScriptSnapshotLite | undefined {
  try {
    const c = asWorkflowCapsule(capsule);
    return { manifest: c.manifest, source: c.source };
  } catch {
    return undefined;
  }
}

async function preflightCapsule(sdk: CodingSdkSubset, capsule: unknown): Promise<WorkflowPreflight> {
  if (!sdk.preflightWorkflowCapsule) return { ok: true, issues: [] };
  try {
    const direct = await sdk.preflightWorkflowCapsule(capsule);
    return { ok: direct.ok, issues: direct.issues ?? [] };
  } catch (err) {
    console.warn(
      '[WorkflowController] preflightWorkflowCapsule direct call failed; retrying boxed capsule:',
      err instanceof Error ? err.message : err,
    );
    const boxed = await sdk.preflightWorkflowCapsule({ capsule });
    return { ok: boxed.ok, issues: boxed.issues ?? [] };
  }
}

function formatPreflightIssues(result: WorkflowPreflight): string {
  if (result.ok) return 'workflow capsule preflight passed';
  const details = result.issues.map((issue) => issue.message).filter(Boolean).join('; ');
  return details ? `workflow capsule preflight failed: ${details}` : 'workflow capsule preflight failed';
}

function firstPatternName(manifest: WorkflowScriptManifestLite): string | undefined {
  return Array.isArray(manifest.patterns) && typeof manifest.patterns[0] === 'string'
    ? manifest.patterns[0]
    : undefined;
}

async function nextRevisionWorkflowName(
  sdk: CodingSdkSubset,
  dirs: SavedWorkflowDirsLite,
  preferredName: string,
): Promise<string> {
  let refs: readonly SavedWorkflowLite[] = [];
  try {
    refs = (await sdk.discoverSavedWorkflows?.(dirs)) ?? [];
  } catch (err) {
    console.warn(
      '[WorkflowController] discoverSavedWorkflows for revision:',
      err instanceof Error ? err.message : err,
    );
    return `${preferredName}-revision-${Date.now().toString(36)}`;
  }
  const existing = new Set(refs.map((ref) => ref.name));
  if (!existing.has(preferredName)) return preferredName;
  return `${preferredName}-revision-${Date.now().toString(36)}`;
}

function currentKodaxWorkflowVersion(): string {
  if (process.env.KODAX_VERSION) return process.env.KODAX_VERSION;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = typeof require !== 'undefined' ? null : (import.meta as any);
    const req = meta ? createRequire(meta.url) : require;
    const pkg = req('@kodax-ai/kodax/package.json') as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version.length > 0) return pkg.version;
  } catch {
    // fall through
  }
  return process.env.npm_package_version ?? 'unknown';
}

function buildRevisionProvenance(input: {
  readonly capsule: WorkflowCapsuleLite;
  readonly target: string;
  readonly savedName?: string;
  readonly replacesWorkflowName?: string;
}): {
  readonly fromRunId?: string;
  readonly fromWorkflowName?: string;
  readonly revisionOf?: string;
  readonly replacesWorkflowName?: string;
  readonly createdAt: string;
  readonly kodaxVersion: string;
} {
  const fromRunId = input.savedName ? input.capsule.provenance?.fromRunId : input.target;
  const fromWorkflowName = input.savedName ?? input.capsule.provenance?.fromWorkflowName;
  const revisionOf = input.savedName ?? input.target;
  return {
    ...(fromRunId !== undefined ? { fromRunId } : {}),
    ...(fromWorkflowName !== undefined ? { fromWorkflowName } : {}),
    ...(revisionOf !== undefined ? { revisionOf } : {}),
    ...(input.replacesWorkflowName !== undefined ? { replacesWorkflowName: input.replacesWorkflowName } : {}),
    createdAt: new Date().toISOString(),
    kodaxVersion: currentKodaxWorkflowVersion(),
  };
}

function buildWorkflowRevisionRequest(input: {
  readonly target: string;
  readonly capsule: WorkflowCapsuleLite;
  readonly changeRequest: string;
}): string {
  return [
    'Revise this existing KodaX dynamic workflow capsule.',
    'Return a complete revised workflow, not a patch.',
    'Preserve the reusable workflow intent, safety requirements, and compatible args shape unless the requested change explicitly requires otherwise.',
    '',
    `Target: ${input.target}`,
    '',
    'Original manifest:',
    JSON.stringify(input.capsule.manifest, null, 2),
    '',
    'Original source:',
    '```js',
    input.capsule.source,
    '```',
    '',
    `Change request: ${input.changeRequest}`,
  ].join('\n');
}

async function loadDefaultManager(): Promise<WorkflowRunManagerLike | null> {
  try {
    // 经 unknown 中转：SDK 的 WorkflowProcessSnapshot 不带我们 SdkProcessSnapshot 的 index
    // signature，strictFunctionTypes 下 listener 形参逆变检查会拒绝直接 cast。我们只用到
    // subscribe/get/list 这个子集，运行时形状一致，中转 unknown 是安全的边界适配。
    const sdk = (await import('@kodax-ai/kodax/coding')) as unknown as {
      getDefaultWorkflowRunManager?: () => WorkflowRunManagerLike;
    };
    if (typeof sdk.getDefaultWorkflowRunManager !== 'function') {
      console.warn('[WorkflowController] sdk.getDefaultWorkflowRunManager unavailable');
      return null;
    }
    return sdk.getDefaultWorkflowRunManager();
  } catch (err) {
    console.warn(
      '[WorkflowController] failed to load SDK workflow run manager:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** Lazy-load 并实例化 SDK 的 run 生命周期控制器(F062 控制能力)。 */
async function loadLifecycle(
  manager: WorkflowRunManagerLike,
  runBaseDir: string,
): Promise<WorkflowLifecycleLike | null> {
  try {
    const sdk = (await import('@kodax-ai/kodax/coding')) as unknown as {
      createWorkflowLifecycleController?: (opts: {
        runManager: unknown;
        runBaseDir: string;
      }) => WorkflowLifecycleLike;
    };
    if (typeof sdk.createWorkflowLifecycleController !== 'function') {
      console.warn('[WorkflowController] sdk.createWorkflowLifecycleController unavailable');
      return null;
    }
    return sdk.createWorkflowLifecycleController({ runManager: manager, runBaseDir });
  } catch (err) {
    console.warn(
      '[WorkflowController] failed to create workflow lifecycle controller:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// 单例。main.ts init / IPC handler / F063-F064 启动登记都通过这个 instance。
export const workflowController = new WorkflowController();
