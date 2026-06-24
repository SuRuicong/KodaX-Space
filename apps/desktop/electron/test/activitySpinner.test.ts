import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { snapshotFromEvents } from '../../renderer/src/shell/ActivitySpinner.js';

const sid = 's_activity_spinner';

test('queued_user_prompt_started keeps spinner alive before the next session_start arrives', () => {
  const events: SessionEvent[] = [
    { kind: 'session_start', sessionId: sid, provider: 'mock' },
    { kind: 'text_delta', sessionId: sid, text: 'done' },
    { kind: 'session_complete', sessionId: sid },
    {
      kind: 'queued_user_prompt_started',
      sessionId: sid,
      queueMode: 'after-turn',
      content: 'follow up',
    },
  ];

  const snapshot = snapshotFromEvents(events, false, undefined);

  assert.equal(snapshot.streaming, true);
  assert.equal(snapshot.status.startsWith('Thinking'), true);
});
