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
import path from 'node:path';
import type { WorkflowRunT, WorkflowEventPayload } from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from './data-paths.js';
import { pushToRenderer } from '../ipc/push.js';

// ---- SDK 形状(只取本控制器用到的子集,避免硬依赖 SDK 类型导出) ----
interface SdkProcessSnapshot {
  readonly runId: string;
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
}

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
}

export interface WorkflowOrigin {
  readonly sessionId?: string;
  readonly surface?: 'code' | 'partner';
}

type PushFn = (payload: WorkflowEventPayload) => void;

// 映射上限——防止长跑进程里 origins 无界增长(终态 run 的归属不再变,留最近 N 条即可)。
const MAX_ORIGINS = 500;

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
    return (await this.lifecycle?.stopWorkflow(runId, reason)) ?? false;
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
    if (ok && this.origins.delete(runId)) void this.persistOrigins();
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

  private onEvent(event: SdkProcessEvent): void {
    const origin = this.origins.get(event.snapshot.runId) ?? {};
    // snapshot 原样转发;push.ts 在 IPC 边界做 zod 校验(失败则丢弃+日志),这里不重复校验。
    this.push({
      type: event.type,
      snapshot: event.snapshot as unknown as WorkflowRunT,
      ...(event.message !== undefined ? { message: event.message } : {}),
      ...(origin.sessionId !== undefined ? { sessionId: origin.sessionId } : {}),
      ...(origin.surface !== undefined ? { surface: origin.surface } : {}),
    });
  }

  private attribute(snapshot: SdkProcessSnapshot): WorkflowRunT {
    // cast 经 unknown:SDK snapshot 结构与 WorkflowRunT 一致,但带 index signature 不直接兼容。
    // 运行时正确性:list/get 出参经 IPC register 校验,push 经 push.ts 校验;drift 由 round-trip
    // 单测 + 真 SDK smoke 守(见 workflow-controller.test.ts)。
    const origin = this.origins.get(snapshot.runId) ?? {};
    return {
      ...(snapshot as unknown as WorkflowRunT),
      ...(origin.sessionId !== undefined ? { sessionId: origin.sessionId } : {}),
      ...(origin.surface !== undefined ? { surface: origin.surface } : {}),
    };
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

/** Lazy-load SDK 的进程级 run manager 单例(与 AMAW/REPL 共享同一实例)。*/
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
