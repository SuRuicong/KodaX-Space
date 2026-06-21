import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionMeta, WorkflowEventPayload } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../renderer/src/store/appStore.js';

const SID = 's_cancel_dedupe';

const session: SessionMeta = {
  sessionId: SID,
  projectRoot: '/proj/x',
  provider: 'mock',
  reasoningMode: 'auto',
  permissionMode: 'accept-edits',
  autoModeEngine: 'llm',
  agentMode: 'ama',
  surface: 'code',
  createdAt: 1700000000000,
  lastActivityAt: 1700000000000,
};

beforeEach(() => {
  useAppStore.setState({
    sessions: [session],
    currentSessionId: SID,
    eventsBySession: {},
    pendingSendBySession: { [SID]: true },
    notifications: [],
    workflowRuns: {},
  });
});

test('appendEvent clears pending send and dedupes repeated cancelled terminal events', () => {
  const store = useAppStore.getState();
  store.appendEvent({
    kind: 'session_error',
    sessionId: SID,
    error: 'cancelled',
    category: 'cancelled',
    retriable: true,
  });
  store.appendEvent({
    kind: 'session_error',
    sessionId: SID,
    error: 'cancelled',
    category: 'cancelled',
    retriable: true,
  });

  const state = useAppStore.getState();
  const events = state.eventsBySession[SID] ?? [];
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'session_error');
  assert.equal(state.pendingSendBySession[SID], undefined);
});

test('appendEvent accepts a later cancelled event after a new session_start', () => {
  const store = useAppStore.getState();
  store.appendEvent({ kind: 'session_error', sessionId: SID, error: 'cancelled' });
  store.appendEvent({ kind: 'session_start', sessionId: SID, provider: 'mock' });
  store.appendEvent({ kind: 'session_error', sessionId: SID, error: 'cancelled' });

  const events = useAppStore.getState().eventsBySession[SID] ?? [];
  assert.deepEqual(
    events.map((event) => event.kind),
    ['session_error', 'session_start', 'session_error'],
  );
});
test('appendEvent turns todo drift warnings into session notifications', () => {
  const store = useAppStore.getState();
  store.appendEvent({
    kind: 'todo_drift_warning',
    sessionId: SID,
    warning: {
      kind: 'work_started_without_claimed_todo',
      toolName: 'write',
      toolCallId: 'tool_1',
      count: 1,
      pendingCount: 2,
      openCount: 2,
      firstPendingTodoId: 'todo_1',
      firstPendingTodoSubject: 'Update tests',
    },
  });

  const state = useAppStore.getState();
  const events = state.eventsBySession[SID] ?? [];
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'todo_drift_warning');
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0]?.severity, 'info');
  assert.equal(state.notifications[0]?.sessionId, SID);
  assert.match(state.notifications[0]?.text ?? '', /Todo list drift detected/);
  assert.match(state.notifications[0]?.text ?? '', /Update tests/);
});

test('upsertWorkflowRun exposes workflow event message as latest live message', () => {
  const store = useAppStore.getState();
  const payload: WorkflowEventPayload = {
    type: 'workflow_updated',
    sessionId: SID,
    surface: 'code',
    message: 'agent spawned: impact reviewer',
    snapshot: {
      runId: 'wf_live',
      workflowName: 'review',
      status: 'running',
      startedAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:05.000Z',
      items: [],
      counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
      progress: {
        spawnedAgents: 1,
        finishedAgents: 0,
        activeAgents: 1,
        failedAgents: 0,
        stoppedAgents: 0,
      },
      latestMessage: 'stale snapshot message',
    },
  };

  store.upsertWorkflowRun(payload);

  const run = useAppStore.getState().workflowRuns.wf_live;
  assert.equal(run?.sessionId, SID);
  assert.equal(run?.surface, 'code');
  assert.equal(run?.latestMessage, 'agent spawned: impact reviewer');
});
