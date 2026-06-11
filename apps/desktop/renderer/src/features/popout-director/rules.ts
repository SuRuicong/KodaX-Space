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
//
// **不自动 promote 'tasks'**(2026-06 用户反馈):agent 一跑就弹独立 Tasks 面板交互很差,
// 而 RightSidebar 的 "Workers" section 本就是 popoutKind='tasks' 的内联摘要、内容也不多。
// worker 信息留在右侧栏内联即可;用户想看完整面板再手动点 ⤢ 展开。

import type { SessionEvent } from '@kodax-space/space-ipc-schema';

/** 哪些 popout kind 受 director 管理 (其他 popout 不自动 promote — 保留给用户主动开)。 */
export type SmartPopoutKind = 'plan' | 'diff';

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
 *   1. plan   (planner-driven 工作流 — 用户应该看)
 *   2. diff   (开始改文件 — 用户应该确认 / preview)
 *
 * caller (useSmartPopoutDirector hook) 拿到结果后:
 *   - null: 什么都不做
 *   - kind: setActivePopout(kind) + 把 kind 加进 promoted set
 */
export function decideAutoPromote(input: DirectorDecisionInput): SmartPopoutKind | null {
  // 用户已经在看别的 popout — 别打扰
  if (input.activePopout !== null) return null;

  // 扫一趟事件流,记下两类信号是否出现过。短路返还:先按优先级序检查,
  // 命中且未 promoted 立刻返。无须扫完事件 (events 可能上千条 — 优先级最高在最前)。
  // 注意:managed_task_status('tasks') 不再自动 promote — 见文件头说明,worker 信息走右侧栏内联。
  let hasPlan = false;
  let hasDiff = false;

  for (const ev of input.events) {
    if (!hasPlan && ev.kind === 'todo_update') {
      if (ev.items.length > 0) hasPlan = true;
    }
    if (!hasDiff && ev.kind === 'tool_start') {
      if (FILE_MUTATION_TOOLS.has(ev.toolName)) hasDiff = true;
    }
    if (hasPlan && hasDiff) break; // 两个都见过,提前出
  }

  // 按优先级取第一个 (a) 已触发 + (b) 未 promoted 的 kind
  if (hasPlan && !input.promoted.has('plan')) return 'plan';
  if (hasDiff && !input.promoted.has('diff')) return 'diff';
  return null;
}
