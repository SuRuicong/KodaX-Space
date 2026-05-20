// FEATURE_037: Worker tree builder.
//
// 把 managed_task_status.events[] (workerId 分组) 折成"按 worker 聚合"的视图模型。
// 纯函数，便于单元测试——TasksPanel 只负责渲染。
//
// 分组规则：
//   - events 里有 workerId → 归入对应 worker bucket（保留事件顺序）
//   - events 没有 workerId（main agent 自己的进度/通知）→ 归入虚拟 root bucket（id='__main__'）
//
// 排序规则：
//   - 当前 activeWorkerId 永远排第一（标识 'active'）
//   - 其余按 worker bucket 内"最新事件 kind" 排：warning > progress (live) > completed
//   - 同优先级按 workerTitle 字典序，最后按 workerId 兜底
//
// Aggregate 字段：
//   - latestKind：tree 节点状态着色（emerald/sky/amber/zinc）
//   - latestPhase：右侧 sublabel
//   - eventCount：worker title 后括号显示

import type { SessionEvent } from '@kodax-space/space-ipc-schema';

type ManagedTaskStatus = Extract<SessionEvent, { kind: 'managed_task_status' }>['status'];
type ManagedLiveEvent = NonNullable<ManagedTaskStatus['events']>[number];

/**
 * Sentinel ID for the "Main agent" bucket — events without an explicit `workerId`.
 * Namespaced (colon, package prefix) so a real KodaX worker can never collide with it
 * even if the schema were relaxed to allow `:` in workerId (reviewer F037 MEDIUM-1).
 */
export const MAIN_WORKER_ID = '__kodax-space:main__';
export const MAIN_WORKER_TITLE = 'Main agent';

export interface WorkerNode {
  readonly workerId: string;
  readonly workerTitle: string;
  readonly isMain: boolean;
  readonly isActive: boolean;
  readonly events: readonly ManagedLiveEvent[];
  /** 最新事件类型（决定状态颜色），无事件时为 undefined */
  readonly latestKind: ManagedLiveEvent['kind'] | undefined;
  /** 最新事件 phase（右侧 sublabel），无则 undefined */
  readonly latestPhase: string | undefined;
  /** 最新事件 summary（worker 主行省略时用） */
  readonly latestSummary: string | undefined;
}

interface BuildOptions {
  readonly activeWorkerId?: string;
  readonly activeWorkerTitle?: string;
}

/**
 * 按 workerId 分组 + 排序成 WorkerNode 列表。
 * - events 为 undefined / empty → 仍可能有 active worker 节点（无事件、只显示标题）
 * - main agent bucket 仅在 1) 有无 workerId 事件 OR 2) activeWorker 是 main 时出现
 */
export function buildWorkerTree(
  status: ManagedTaskStatus | undefined,
  opts?: BuildOptions,
): readonly WorkerNode[] {
  if (!status) return [];
  const events = status.events ?? [];
  const activeWorkerId = opts?.activeWorkerId ?? status.activeWorkerId;
  const activeWorkerTitle = opts?.activeWorkerTitle ?? status.activeWorkerTitle;

  // 1. 按 workerId 聚合（保留事件顺序）
  type Bucket = {
    workerId: string;
    workerTitle: string;
    events: ManagedLiveEvent[];
  };
  const buckets = new Map<string, Bucket>();
  for (const ev of events) {
    // 用 falsy 兜底而非 ?? —— schema 没限制 workerId.min(1)，'' 也合法但应该等同 undefined
    // 归到 main bucket（reviewer F037 HIGH-1）。
    const wid = ev.workerId || MAIN_WORKER_ID;
    const existing = buckets.get(wid);
    if (existing) {
      existing.events.push(ev);
      // worker title 取最后非空——KodaX 可能在第一个事件里没填 workerTitle
      if (ev.workerTitle) existing.workerTitle = ev.workerTitle;
    } else {
      buckets.set(wid, {
        workerId: wid,
        workerTitle: ev.workerTitle || (wid === MAIN_WORKER_ID ? MAIN_WORKER_TITLE : 'Worker'),
        events: [ev],
      });
    }
  }

  // 2. activeWorkerId 即便没有事件，也建空 bucket（让 tree 有显示）。
  // activeWorkerTitle 缺省 → 显示 'Worker'（reviewer F037 LOW-1：避免 UUID 串原样塞标题位）。
  if (activeWorkerId && !buckets.has(activeWorkerId)) {
    buckets.set(activeWorkerId, {
      workerId: activeWorkerId,
      workerTitle: activeWorkerTitle || 'Worker',
      events: [],
    });
  }

  // 3. 转成 WorkerNode，加 aggregate 字段
  const nodes: WorkerNode[] = Array.from(buckets.values()).map((b) => {
    const last = b.events[b.events.length - 1];
    return {
      workerId: b.workerId,
      workerTitle: b.workerTitle,
      isMain: b.workerId === MAIN_WORKER_ID,
      isActive: activeWorkerId !== undefined && b.workerId === activeWorkerId,
      events: b.events.slice(),
      latestKind: last?.kind,
      latestPhase: last?.phase,
      latestSummary: last?.summary,
    };
  });

  // 4. 排序：active 第一；之后按 latestKind 优先级；同 priority 按 title
  const KIND_PRIORITY: Record<ManagedLiveEvent['kind'], number> = {
    warning: 0,
    progress: 1,
    notification: 2,
    completed: 3,
  };
  nodes.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    const ap = a.latestKind ? KIND_PRIORITY[a.latestKind] : 99;
    const bp = b.latestKind ? KIND_PRIORITY[b.latestKind] : 99;
    if (ap !== bp) return ap - bp;
    if (a.workerTitle !== b.workerTitle) return a.workerTitle.localeCompare(b.workerTitle);
    return a.workerId.localeCompare(b.workerId);
  });
  return nodes;
}
