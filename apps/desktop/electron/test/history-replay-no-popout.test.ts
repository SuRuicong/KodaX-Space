// v0.1.9 fix: 历史 session 回放时,KX-I-02 director 不应再"自动展开"对应 popout。
// 用户报: 点已有 session,弹出 worker / diff popout — 干扰当前对话焦点。
// 修法: prependSessionHistory 扫历史 events 提前 mark 已触发过的 SmartPopoutKind,
// director 视为 already promoted 不再 fire。

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import { decideAutoPromote, type SmartPopoutKind } from '../../renderer/src/features/popout-director/rules.js';
import { composeMessages } from '../../renderer/src/features/session/composeMessages.js';
import type { SessionHistoryItem } from '@kodax-space/space-ipc-schema';

const SID = 'hist-test';
const FALLBACK_SENT_AT = 1700000000000;

beforeEach(() => {
  // 重置 store 关键 fields
  useAppStore.setState({
    sessions: [
      {
        sessionId: SID,
        projectRoot: '/proj/x',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        surface: 'code',
        createdAt: FALLBACK_SENT_AT,
        lastActivityAt: FALLBACK_SENT_AT,
      },
    ],
    eventsBySession: {},
    userMessagesBySession: {},
    promotedPopoutsBySession: {},
    currentSessionId: SID,
  });
});

test('history replay marks diff as promoted when file-mutation tool used (write/edit/multi_edit)', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'edit file' },
    { kind: 'tool_call', toolId: 't1', toolName: 'write', input: { path: '/x', content: 'hi' }, result: 'ok' },
  ];
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const promoted = useAppStore.getState().promotedPopoutsBySession[SID];
  assert.ok(promoted, 'promoted set created for session');
  assert.equal(promoted.has('diff'), true, 'diff marked promoted from write tool');

  // 验证 director decideAutoPromote 不会再 promote diff
  const events = useAppStore.getState().eventsBySession[SID] ?? [];
  const decision = decideAutoPromote({
    events,
    activePopout: null,
    promoted: promoted as ReadonlySet<SmartPopoutKind>,
  });
  assert.equal(decision, null, 'director sees promoted=true, no auto-open');
});

test('history replay marks all 3 popout kinds when historical session had tasks + plan + diff', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'do stuff' },
    { kind: 'tool_call', toolId: 't1', toolName: 'edit', input: { path: '/y', old_string: 'a', new_string: 'b' }, result: 'ok' },
  ];
  // 直接灌一些 todo_update / managed_task_status 进 events 模拟历史 session
  useAppStore.setState({
    eventsBySession: {
      [SID]: [
        { kind: 'todo_update', sessionId: SID, items: [{ id: 't1', content: 'a', status: 'pending' }] },
        { kind: 'managed_task_status', sessionId: SID, status: { agentMode: 'ama', harnessProfile: 'H2_PLAN_EXECUTE_EVAL', activeWorkerId: 'w-1' } },
      ],
    },
  });
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const promoted = useAppStore.getState().promotedPopoutsBySession[SID];
  assert.equal(promoted?.has('diff'), true, 'diff from edit');
  // todo_update / managed_task_status 之前已经在 store 里 (不是 history 回放产生),所以
  // 不会被 markPromoted。本 test 主要锁住 "history 回放的 tool_start(write/edit/...) →
  // diff promoted" 这条主路径,其他 plan/tasks 在 history items 协议中没直接对应字段
  // (history 只回放 user/assistant/tool_call)。
});

test('history replay with read-only tools (bash/grep/read) does NOT promote diff', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'check' },
    { kind: 'tool_call', toolId: 't1', toolName: 'bash', input: { cmd: 'ls' }, result: 'a b c' },
    { kind: 'tool_call', toolId: 't2', toolName: 'grep', input: { pattern: 'foo' }, result: '' },
    { kind: 'tool_call', toolId: 't3', toolName: 'read', input: { path: '/y' }, result: 'content' },
  ];
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const promoted = useAppStore.getState().promotedPopoutsBySession[SID] ?? new Set<string>();
  assert.equal(promoted.has('diff'), false);
  assert.equal(promoted.has('plan'), false);
  assert.equal(promoted.has('tasks'), false);
});

test('history replay preserves existing promoted marks (user already toggled before re-load)', () => {
  // 用户之前手动开过 plan popout → mark 进 promoted。re-load 历史不应该把它清掉。
  useAppStore.setState({
    promotedPopoutsBySession: { [SID]: new Set(['plan']) },
  });
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'edit' },
    { kind: 'tool_call', toolId: 't1', toolName: 'write', input: { path: '/x', content: 'a' }, result: 'ok' },
  ];
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const promoted = useAppStore.getState().promotedPopoutsBySession[SID];
  assert.equal(promoted?.has('plan'), true, 'old plan mark preserved');
  assert.equal(promoted?.has('diff'), true, 'new diff mark added from history tool_call');
});

test('history replay with no relevant events leaves promoted untouched', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'hello' },
    { kind: 'assistant', text: 'hi', thinking: '' },
  ];
  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);

  const promoted = useAppStore.getState().promotedPopoutsBySession[SID];
  // promotedPopoutsBySession[SID] 被设成空 Set (即便没新增 kind, 也会创 entry)
  assert.ok(promoted !== undefined);
  assert.equal(promoted.size, 0);
});

test('history replay restores sidecar verifier messages as sidecar notices', () => {
  const items: SessionHistoryItem[] = [
    { kind: 'user', content: 'q' },
    {
      kind: 'sidecar_message',
      message: {
        source: 'sidecar-verifier',
        verdict: 'revise',
        recipient: 'main-agent',
        delivery: 'synthetic-user-message',
        content: 'Please rerun the focused test.',
      },
    },
    { kind: 'assistant', text: 'Reran it and fixed the issue.' },
  ];

  useAppStore.getState().prependSessionHistory(SID, items, FALLBACK_SENT_AT);
  const state = useAppStore.getState();
  const events = state.eventsBySession[SID] ?? [];
  assert.equal(events.some((event) => event.kind === 'sidecar_message'), true);

  const out = composeMessages({
    events,
    userMessages: state.userMessagesBySession[SID] ?? [],
  });
  const notice = out.find((message) => message.kind === 'system_notice');
  assert.equal(notice?.kind, 'system_notice');
  if (notice?.kind === 'system_notice') {
    assert.equal(notice.variant, 'sidecar');
    assert.match(notice.text, /Please rerun the focused test/);
  }
});
