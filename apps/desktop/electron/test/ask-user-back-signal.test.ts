// Drift guard: Space defines ASK_USER_BACK_SIGNAL in the shared ipc-schema (so the
// browser renderer, which cannot import the ESM-only SDK, has a single source of
// truth). The SDK exports its own ASK_USER_BACK_SIGNAL (@kodax-ai/kodax/agent). If
// the SDK ever changes the sentinel, this test fails loudly instead of silently
// breaking ask_user "go back" navigation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASK_USER_BACK_SIGNAL } from '@kodax-space/space-ipc-schema';

test('Space ASK_USER_BACK_SIGNAL matches the SDK export', async () => {
  const agent = (await import('@kodax-ai/kodax/agent')) as { ASK_USER_BACK_SIGNAL?: unknown };
  assert.equal(
    typeof agent.ASK_USER_BACK_SIGNAL,
    'string',
    'SDK no longer exports ASK_USER_BACK_SIGNAL from @kodax-ai/kodax/agent',
  );
  assert.equal(
    ASK_USER_BACK_SIGNAL,
    agent.ASK_USER_BACK_SIGNAL,
    'Space ASK_USER_BACK_SIGNAL drifted from the SDK value — update the schema constant',
  );
});
