// KX-I-02 Smart Popout Director — unit tests for the pure decision rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import {
  decideAutoPromote,
  type SmartPopoutKind,
} from '../../renderer/src/features/popout-director/rules.js';

const SID = 'sess-A';

function emptySet(): ReadonlySet<SmartPopoutKind> {
  return new Set<SmartPopoutKind>();
}

// ---- minimal event factories (just enough fields for decideAutoPromote) ----

function todoUpdate(itemCount: number): SessionEvent {
  return {
    kind: 'todo_update',
    sessionId: SID,
    items: Array.from({ length: itemCount }, (_, i) => ({
      id: `t-${i}`,
      content: `task ${i}`,
      status: 'pending' as const,
    })),
  };
}

function toolStart(toolName: string): SessionEvent {
  return {
    kind: 'tool_start',
    sessionId: SID,
    toolId: 'tid-x',
    toolName,
  };
}

function managedTaskStatus(activeWorkerId: string | undefined): SessionEvent {
  return {
    kind: 'managed_task_status',
    sessionId: SID,
    status: {
      agentMode: 'ama',
      harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
      ...(activeWorkerId !== undefined ? { activeWorkerId } : {}),
    },
  };
}

// ---- never-promote scenarios ----

test('returns null when activePopout is non-null (do not steal from user)', () => {
  const result = decideAutoPromote({
    events: [todoUpdate(3), toolStart('write'), managedTaskStatus('w-1')],
    activePopout: 'preview',
    promoted: emptySet(),
  });
  assert.equal(result, null);
});

test('returns null when no relevant events have fired', () => {
  const result = decideAutoPromote({
    events: [
      { kind: 'text_delta', sessionId: SID, text: 'hello' },
      { kind: 'session_start', sessionId: SID, provider: 'mock' },
    ],
    activePopout: null,
    promoted: emptySet(),
  });
  assert.equal(result, null);
});

test('returns null when events is empty', () => {
  const result = decideAutoPromote({ events: [], activePopout: null, promoted: emptySet() });
  assert.equal(result, null);
});

// ---- positive triggers ----

test('promotes plan on first todo_update with items', () => {
  const result = decideAutoPromote({
    events: [todoUpdate(2)],
    activePopout: null,
    promoted: emptySet(),
  });
  assert.equal(result, 'plan');
});

test('does NOT promote plan when todo_update items is empty', () => {
  const result = decideAutoPromote({
    events: [todoUpdate(0)],
    activePopout: null,
    promoted: emptySet(),
  });
  assert.equal(result, null);
});

test('promotes diff on first file-mutation tool_start (write)', () => {
  const result = decideAutoPromote({
    events: [toolStart('write')],
    activePopout: null,
    promoted: emptySet(),
  });
  assert.equal(result, 'diff');
});

test('promotes diff for edit / multi_edit / str_replace / insert_after_anchor too', () => {
  for (const tool of ['edit', 'multi_edit', 'str_replace', 'insert_after_anchor']) {
    const result = decideAutoPromote({
      events: [toolStart(tool)],
      activePopout: null,
      promoted: emptySet(),
    });
    assert.equal(result, 'diff', `tool=${tool}`);
  }
});

test('does NOT promote diff on read-only tools (bash / grep / glob)', () => {
  for (const tool of ['bash', 'grep', 'glob', 'read']) {
    const result = decideAutoPromote({
      events: [toolStart(tool)],
      activePopout: null,
      promoted: emptySet(),
    });
    assert.equal(result, null, `tool=${tool}`);
  }
});

test('promotes tasks when managed_task_status has activeWorkerId', () => {
  const result = decideAutoPromote({
    events: [managedTaskStatus('worker-1')],
    activePopout: null,
    promoted: emptySet(),
  });
  assert.equal(result, 'tasks');
});

test('does NOT promote tasks on managed_task_status without activeWorkerId (SA path)', () => {
  const result = decideAutoPromote({
    events: [managedTaskStatus(undefined)],
    activePopout: null,
    promoted: emptySet(),
  });
  assert.equal(result, null);
});

test('does NOT promote tasks on empty-string activeWorkerId (defensive)', () => {
  const result = decideAutoPromote({
    events: [managedTaskStatus('')],
    activePopout: null,
    promoted: emptySet(),
  });
  assert.equal(result, null);
});

// ---- priority ordering ----

test('priority: tasks > plan > diff when multiple triggered simultaneously', () => {
  const result = decideAutoPromote({
    events: [toolStart('write'), todoUpdate(1), managedTaskStatus('w-1')],
    activePopout: null,
    promoted: emptySet(),
  });
  assert.equal(result, 'tasks');
});

test('priority: plan > diff when both triggered (no tasks)', () => {
  const result = decideAutoPromote({
    events: [toolStart('write'), todoUpdate(1)],
    activePopout: null,
    promoted: emptySet(),
  });
  assert.equal(result, 'plan');
});

// ---- promoted set behavior ----

test('skips promoted kinds — promotes the next-priority unpromoted kind', () => {
  const promoted = new Set<SmartPopoutKind>(['tasks']);
  const result = decideAutoPromote({
    events: [toolStart('write'), todoUpdate(1), managedTaskStatus('w-1')],
    activePopout: null,
    promoted,
  });
  // tasks promoted → next priority is plan
  assert.equal(result, 'plan');
});

test('skips promoted across all three — returns null', () => {
  const promoted = new Set<SmartPopoutKind>(['tasks', 'plan', 'diff']);
  const result = decideAutoPromote({
    events: [toolStart('write'), todoUpdate(1), managedTaskStatus('w-1')],
    activePopout: null,
    promoted,
  });
  assert.equal(result, null);
});

test('promoted skip respects priority — promoted=plan, has tasks+diff → tasks wins', () => {
  const promoted = new Set<SmartPopoutKind>(['plan']);
  const result = decideAutoPromote({
    events: [toolStart('write'), todoUpdate(1), managedTaskStatus('w-1')],
    activePopout: null,
    promoted,
  });
  assert.equal(result, 'tasks');
});

test('promoted skip — only diff fires + diff promoted → null', () => {
  const promoted = new Set<SmartPopoutKind>(['diff']);
  const result = decideAutoPromote({
    events: [toolStart('write')],
    activePopout: null,
    promoted,
  });
  assert.equal(result, null);
});

// ---- input set is immutable (decideAutoPromote does not mutate caller's set) ----

test('decideAutoPromote does not mutate the promoted set passed in', () => {
  const promoted = new Set<SmartPopoutKind>();
  const before = [...promoted];
  decideAutoPromote({
    events: [todoUpdate(2)],
    activePopout: null,
    promoted,
  });
  assert.deepEqual([...promoted], before);
});

// ---- reopen behavior (review HIGH-1 anti-regression) ----
//
// 用户在 plan 信号到达之前手动开 'preview',再关掉 'preview' (activePopout 回到 null)。
// 此后 plan 信号触发 → director 仍能正常 auto-promote plan。decideAutoPromote 只看
// 当前那一次调用的 activePopout 值,不持有"曾经开过别的 popout"的状态。
test('reopen scenario — user closes a non-director popout, plan signal still auto-promotes', () => {
  // Phase 1: 用户开了 preview (activePopout='preview'),即便 plan 信号已经到 → 不抢
  const phase1 = decideAutoPromote({
    events: [todoUpdate(2)],
    activePopout: 'preview',
    promoted: emptySet(),
  });
  assert.equal(phase1, null);

  // Phase 2: 用户关 preview (activePopout=null),plan 信号还在 → 该 promote
  const phase2 = decideAutoPromote({
    events: [todoUpdate(2)],
    activePopout: null,
    promoted: emptySet(), // preview 不是 director 管的 kind,不会被 mark promoted
  });
  assert.equal(phase2, 'plan');
});

// ---- defensive: long event streams don't crash ----

test('handles 1000-event stream without throwing', () => {
  const events: SessionEvent[] = [];
  for (let i = 0; i < 1000; i++) {
    events.push({ kind: 'text_delta', sessionId: SID, text: `chunk ${i}` });
  }
  events.push(toolStart('write'));
  const result = decideAutoPromote({ events, activePopout: null, promoted: emptySet() });
  assert.equal(result, 'diff');
});
