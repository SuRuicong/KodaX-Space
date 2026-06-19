import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateApiKeyEnv } from '../providers/env-guard.js';

test('validateApiKeyEnv rejects runtime control environment variables', () => {
  assert.match(validateApiKeyEnv('NODE_ENV') ?? '', /reserved/);
  assert.match(validateApiKeyEnv('NODE_OPTIONS') ?? '', /reserved/);
});

test('validateApiKeyEnv error message documents the 128 character limit', () => {
  assert.equal(validateApiKeyEnv(`A${'B'.repeat(127)}`), null);
  const err = validateApiKeyEnv(`A${'B'.repeat(128)}`);
  assert.match(err ?? '', /\{0,127\}/);
  assert.match(err ?? '', /max 128/);
});
