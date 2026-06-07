// KX-I-02 Smart Popout Director — pure decision rules.
//
// 输入 session event 时间序列 + 当前 popout 状态 + 已 promoted 集合,
// 输出"现在应该自动 promote 哪个 popout (kind)"或 null。
//
// 设计原则:
//   - **纯函数**,无 React / store 依赖,便于单测 + 未来从 UI 解耦
//   - **per-session × per-kind 最多 promote 一次** —— promoted set 是 caller 维护的,
//     decidePromote 不可变它;caller 在拿到非 null 决策后自己 mark promoted
//   - **不抢用户**: activePopout 已经非 null → 永不 promote
//     (用户已经在看别的 popout,自动切走会很烦)
//   - **不打扰一次性内容**: 已 promoted 就不再 emit (再次出现同信号也不抢)
//
// 触发规则 (按"应该自动展开哪个 popout"维度):
//   plan   ← session events 含 `todo_update` 且 items.length > 0
//   diff   ← tool_start.toolName ∈ FILE_MUTATION_TOOLS (write/edit/multi_edit/...)
//   tasks  ← managed_task_status.activeWorkerId 出现 (AMA 多 worker 协作启动)

import type { SessionEvent } from '@kodax-space/space-ipc-schema';

/** 哪些 popout kind 受 director 管理 (其他 popout 不自动 promote — 保留给用户主动开)。 */
export type SmartPopoutKind = 'plan' | 'diff' | 'tasks';

/** broker.ts:48 EDIT_TOOLS 同款 — 拷过来避免 renderer 跨边界 import。 */
const FILE_MUTATION_TOOLS: ReadonlySet<string> = new Set([
  'edit',
  'write',
  'multi_edit',
  'str_replace',
  'insert_after_anchor',
]);

export interface DirectorDecisionInput {
  /** 当前 session 完整事件流。Director 自己扫,自己判 "首次出现"。*/
  readonly events: readonly SessionEvent[];
  /** 当前已激活的 popout (Shell.activePopout)。非 null 时永不 promote。*/
  readonly activePopout: string | null;
  /** 该 session 已经被 director auto-promote 过的 kind 集合,不会再 promote 同 kind。*/
  readonly promoted: ReadonlySet<SmartPopoutKind>;
}

/**
 * 跑一遍 rules 看是否应该 auto-promote 某个 popout。
 *
 * 优先级 (同一帧多触发时):
 *   1. tasks  (multi-worker 协作 — 最高,看不见 worker 等于盲跑)
 *   2. plan   (planner-driven 工作流 — 用户应该看)
 *   3. diff   (开始改文件 — 用户应该确认 / preview)
 *
 * caller (useSmartPopoutDirector hook) 拿到结果后:
 *   - null: 什么都不做
 *   - kind: setActivePopout(kind) + 把 kind 加进 promoted set
 */
export function decideAutoPromote(input: DirectorDecisionInput): SmartPopoutKind | null {
  // 用户已经在看别的 popout — 别打扰
  if (input.activePopout !== null) return null;

  // 扫一趟事件流,记下三类信号是否出现过。短路返还:先按优先级序检查,
  // 命中且未 promoted 立刻返。无须扫完事件 (events 可能上千条 — 优先级最高在最前)。
  let hasTasks = false;
  let hasPlan = false;
  let hasDiff = false;

  for (const ev of input.events) {
    if (!hasTasks && ev.kind === 'managed_task_status') {
      // activeWorkerId 出现才算 "AMA 真的在多 worker 跑"。空 status (例如启动头一帧)
      // 不应触发,避免普通 SA 路径误开 tasks。
      if (ev.status.activeWorkerId !== undefined && ev.status.activeWorkerId !== '') {
        hasTasks = true;
      }
    }
    if (!hasPlan && ev.kind === 'todo_update') {
      if (ev.items.length > 0) hasPlan = true;
    }
    if (!hasDiff && ev.kind === 'tool_start') {
      if (FILE_MUTATION_TOOLS.has(ev.toolName)) hasDiff = true;
    }
    if (hasTasks && hasPlan && hasDiff) break; // 三个都见过,提前出
  }

  // 按优先级取第一个 (a) 已触发 + (b) 未 promoted 的 kind
  if (hasTasks && !input.promoted.has('tasks')) return 'tasks';
  if (hasPlan && !input.promoted.has('plan')) return 'plan';
  if (hasDiff && !input.promoted.has('diff')) return 'diff';
  return null;
}
