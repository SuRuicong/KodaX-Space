// Provider/model picker model resolution (pure; renderer util tested from the
// electron node:test suite). Guards the recurring "ProviderA · ProviderB-model"
// mismatch caused by pendingModel persisting across restarts while the provider
// does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActiveModel } from '../../renderer/src/shell/resolveActiveModel.js';

const mimo = {
  activeProviderId: 'mimo-coding',
  activeProviderModels: ['mimo-v2.5-pro', 'mimo-v2.5'],
  activeProviderDefaultModel: 'mimo-v2.5-pro',
};

test('BUG: stale pendingModel from another provider is NOT shown (falls to provider default)', () => {
  // The exact reported case: MiMo provider + persisted glm-5.2 (a Zhipu model).
  const out = resolveActiveModel({
    ...mimo,
    pendingModel: 'glm-5.2',
    kodaxDefaultsProvider: null,
    kodaxDefaultsModel: null,
  });
  assert.equal(out, 'mimo-v2.5-pro'); // not 'glm-5.2'
});

test('pendingModel that belongs to the active provider IS used', () => {
  const out = resolveActiveModel({
    ...mimo,
    pendingModel: 'mimo-v2.5',
    kodaxDefaultsProvider: null,
    kodaxDefaultsModel: null,
  });
  assert.equal(out, 'mimo-v2.5');
});

test('kodaxDefaults.model used only when its provider is the active one', () => {
  // matching provider → use it
  assert.equal(
    resolveActiveModel({
      ...mimo,
      pendingModel: null,
      kodaxDefaultsProvider: 'mimo-coding',
      kodaxDefaultsModel: 'mimo-v2.5',
    }),
    'mimo-v2.5',
  );
  // different provider → ignore, fall to provider default
  assert.equal(
    resolveActiveModel({
      ...mimo,
      pendingModel: null,
      kodaxDefaultsProvider: 'zhipu-coding',
      kodaxDefaultsModel: 'glm-5.2',
    }),
    'mimo-v2.5-pro',
  );
});

test('falls back to provider default, then em-dash', () => {
  assert.equal(
    resolveActiveModel({
      activeProviderId: 'p',
      activeProviderModels: [],
      activeProviderDefaultModel: 'p-default',
      pendingModel: 'other',
      kodaxDefaultsProvider: null,
      kodaxDefaultsModel: null,
    }),
    'p-default',
  );
  assert.equal(
    resolveActiveModel({
      activeProviderId: 'p',
      activeProviderModels: undefined,
      activeProviderDefaultModel: undefined,
      pendingModel: null,
      kodaxDefaultsProvider: null,
      kodaxDefaultsModel: null,
    }),
    '—',
  );
});

test('precedence: a valid pendingModel wins over kodaxDefaults.model', () => {
  assert.equal(
    resolveActiveModel({
      ...mimo,
      pendingModel: 'mimo-v2.5', // valid for active provider
      kodaxDefaultsProvider: 'mimo-coding',
      kodaxDefaultsModel: 'mimo-v2.5-pro',
    }),
    'mimo-v2.5',
  );
});

test('single-model provider (no models[] but defaultModel): pendingModel==default is accepted', () => {
  assert.equal(
    resolveActiveModel({
      activeProviderId: 'p',
      activeProviderModels: undefined,
      activeProviderDefaultModel: 'only-model',
      pendingModel: 'only-model',
      kodaxDefaultsProvider: null,
      kodaxDefaultsModel: null,
    }),
    'only-model',
  );
});
