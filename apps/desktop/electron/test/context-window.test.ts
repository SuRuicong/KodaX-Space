import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeModelContextWindow,
  SDK_HARD_FALLBACK_CONTEXT_WINDOW,
} from '../providers/context-window.js';

// ---- Pure logic (no SDK) --------------------------------------------------

test('computeModelContextWindow: provider-advertised value passes through as "provider"', () => {
  const provider = { getEffectiveContextWindow: () => 1_000_000 };
  const r = computeModelContextWindow(provider, 'glm-5.2', () => 1_000_000);
  assert.deepEqual(r, { contextWindow: 1_000_000, source: 'provider' });
});

test('computeModelContextWindow: real 200k on a provider WITH resolver methods stays "provider"', () => {
  // e.g. claude — genuinely 200k, not a fallback.
  const provider = { getEffectiveContextWindow: () => 200_000 };
  const r = computeModelContextWindow(provider, 'claude-sonnet-4-6', () => 200_000);
  assert.deepEqual(r, { contextWindow: 200_000, source: 'provider' });
});

test('computeModelContextWindow: 200k with NO resolver methods is flagged "fallback"', () => {
  // custom_* / unresolved provider — renderer should prefer its hardcoded table.
  const provider = {};
  const r = computeModelContextWindow(provider, 'whatever', () => SDK_HARD_FALLBACK_CONTEXT_WINDOW);
  assert.deepEqual(r, { contextWindow: 200_000, source: 'fallback' });
});

// ---- Real SDK regression guard -------------------------------------------
//
// Guards the exact "反复出问题" regression: GLM-5.2 on the coding-plan providers
// must report its real 1M window, and Space must resolve it via the runtime
// cascade (resolveContextWindow), NOT resolveModelCapabilities().contextWindow
// which SDK 0.7.58 returns as the provider default (200k) when the queried model
// equals the provider's default model.

test('real SDK: GLM-5.2 on coding-plan providers resolves to 1M via Space helper', async () => {
  const coding = await import('@kodax-ai/kodax/coding');
  const agent = await import('@kodax-ai/kodax/agent');

  for (const providerId of ['zhipu-coding', 'zai-coding']) {
    const provider = coding.resolveProvider(providerId) as {
      getEffectiveContextWindow?: unknown;
      getContextWindow?: unknown;
    };
    const r = computeModelContextWindow(provider, 'glm-5.2', agent.resolveContextWindow);
    assert.equal(
      r.contextWindow,
      1_000_000,
      `${providerId}/glm-5.2 must report 1M (got ${r.contextWindow}); ` +
        'if this fails, Space likely regressed to resolveModelCapabilities().contextWindow',
    );
    assert.equal(r.source, 'provider', `${providerId}/glm-5.2 source should be 'provider'`);
  }
});

test('real SDK: resolveModelCapabilities STILL has the default-model context bug (documents why Space avoids it)', async () => {
  // If this ever starts FAILING (i.e. the SDK fixed the bug), it is safe to also
  // trust resolveModelCapabilities().contextWindow — update the note in
  // providers/context-window.ts. Until then, Space must not depend on it.
  const llm = await import('@kodax-ai/kodax/llm');
  const buggy = llm.resolveModelCapabilities('zhipu-coding', 'glm-5.2');
  const healthy = llm.resolveModelCapabilities('zhipu', 'glm-5.2');
  assert.equal(healthy?.contextWindow, 1_000_000, 'zhipu (default=glm-5) reads model-level correctly');
  assert.equal(
    buggy?.contextWindow,
    200_000,
    'zhipu-coding (default=glm-5.2) returns provider-level default — the SDK bug Space works around',
  );
});
