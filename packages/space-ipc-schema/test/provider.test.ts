import { test } from 'node:test';
import assert from 'node:assert/strict';

import { providerAddCustomChannel } from '../src/index.js';

const BASE_INPUT = {
  displayName: 'Internal Gateway',
  protocol: 'openai' as const,
  apiKeyEnv: 'INTERNAL_GATEWAY_API_KEY',
  defaultModel: 'gateway-model',
};

test('provider.addCustom accepts internal http IP:port when URL safety checks are skipped', () => {
  const result = providerAddCustomChannel.input.safeParse({
    ...BASE_INPUT,
    baseUrl: 'http://10.8.0.12:8080/v1',
    skipBaseUrlValidation: true,
  });

  assert.equal(result.success, true);
});

test('provider.addCustom still rejects http URL when URL safety checks are not skipped', () => {
  const result = providerAddCustomChannel.input.safeParse({
    ...BASE_INPUT,
    baseUrl: 'http://10.8.0.12:8080/v1',
  });

  assert.equal(result.success, false);
});
