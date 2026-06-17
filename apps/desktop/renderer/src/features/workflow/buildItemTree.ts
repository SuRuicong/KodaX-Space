// F061 — 把 WorkflowProcessSnapshot.items[] 扁平列表构造成 phase/agent/step 树。
//
// SDK 的 item 用 parentId 显式建父子;phaseId 把节点归入某个 phase。优先 parentId,
// 缺省回退 phaseId(若该 phase item 存在)。无父 / 父不存在 → 顶层 root。保持输入顺序、
// cycle-safe(防 SDK 数据异常自指/环导致无限递归)。

import type { WorkflowProcessItemT } from '@kodax-space/space-ipc-schema';

export interface WorkflowTreeNode {
  readonly item: WorkflowProcessItemT;
  // 非 readonly：构造期用 push 连边（readonly 数组只防重赋值、不防 push，标 readonly 反而误导）。
  // 返回后调用方仅读不改。
  children: WorkflowTreeNode[];
}

/** 解析某 item 的父 id:parentId 优先,回退 phaseId;指向自身 / 不存在 → 无父(root)。 */
function resolveParentId(
  item: WorkflowProcessItemT,
  byId: ReadonlyMap<string, WorkflowProcessItemT>,
): string | null {
  const pid = item.parentId;
  if (pid && pid !== item.id && byId.has(pid)) return pid;
  const phid = item.phaseId;
  if (phid && phid !== item.id && byId.has(phid)) return phid;
  return null;
}

/** true 当从 startId 沿 parent 链能走到 targetId(用于建边前的环检测)。 */
function reaches(
  startId: string,
  targetId: string,
  parentOf: ReadonlyMap<string, string | null>,
): boolean {
  const seen = new Set<string>();
  let cur: string | null = startId;
  while (cur !== null && !seen.has(cur)) {
    if (cur === targetId) return true;
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}

/**
 * 构造森林。返回顶层节点数组(输入顺序);每个节点的 children 也按输入顺序。
 * 重复 id 容错:同 id 取首个,后续忽略(避免节点重复)。
 */
export function buildItemTree(items: readonly WorkflowProcessItemT[]): WorkflowTreeNode[] {
  const byId = new Map<string, WorkflowProcessItemT>();
  for (const it of items) {
    if (!byId.has(it.id)) byId.set(it.id, it);
  }

  // 先定每个 id 的父(含环检测:若连边会成环则降级为 root)。
  const parentOf = new Map<string, string | null>();
  for (const it of byId.values()) {
    let pid = resolveParentId(it, byId);
    // 若把 it 挂到 pid 下会让 pid 经由现有边回到 it(成环)→ 断开,改 root。
    if (pid !== null && reaches(pid, it.id, parentOf)) pid = null;
    parentOf.set(it.id, pid);
  }

  const nodeOf = new Map<string, WorkflowTreeNode>();
  for (const it of byId.values()) nodeOf.set(it.id, { item: it, children: [] });

  const roots: WorkflowTreeNode[] = [];
  // 按原始输入顺序连边,保证 children / roots 顺序稳定。
  for (const it of items) {
    const node = nodeOf.get(it.id);
    if (!node || node.item !== it) continue; // 重复 id 的后续项跳过
    const pid = parentOf.get(it.id) ?? null;
    if (pid === null) {
      roots.push(node);
    } else {
      nodeOf.get(pid)?.children.push(node);
    }
  }
  return roots;
}
