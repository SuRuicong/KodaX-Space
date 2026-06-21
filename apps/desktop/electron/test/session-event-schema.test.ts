import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionEventChannel } from '@kodax-space/space-ipc-schema';

test('session.event accepts SDK 0.7.53 sidecar verifier messages', () => {
  assert.equal(
    sessionEventChannel.payload.safeParse({
      kind: 'sidecar_message',
      sessionId: 's_1',
      message: {
        source: 'sidecar-verifier',
        verdict: 'revise',
        recipient: 'main-agent',
        delivery: 'synthetic-user-message',
        content: 'Please verify the edited file before finishing.',
        suggestedFix: 'Run the relevant test.',
      },
    }).success,
    true,
  );

  assert.equal(
    sessionEventChannel.payload.safeParse({
      kind: 'sidecar_message',
      sessionId: 's_1',
      message: {
        source: 'sidecar-verifier',
        verdict: 'accept',
        recipient: 'main-agent',
        delivery: 'synthetic-user-message',
        content: 'accept verdicts should stay silent',
      },
    }).success,
    false,
  );
});

test('session.event accepts SDK 0.7.53 todo drift warnings', () => {
  assert.equal(
    sessionEventChannel.payload.safeParse({
      kind: 'todo_drift_warning',
      sessionId: 's_1',
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
    }).success,
    true,
  );
});