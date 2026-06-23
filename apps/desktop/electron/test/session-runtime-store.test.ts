import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionRuntimeStore } from '../kodax/session-runtime-store.js';

let tmpDir = '';
let store: SessionRuntimeStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-session-runtime-'));
  store = new SessionRuntimeStore(path.join(tmpDir, 'runtime'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test('SessionRuntimeStore merges partial runtime patches', async () => {
  await store.set('s_runtime-1', { permissionMode: 'auto', autoModeEngine: 'rules' });
  await store.set('s_runtime-1', { reasoningMode: 'deep', agentMode: 'sa' });

  assert.deepEqual(await store.read('s_runtime-1'), {
    permissionMode: 'auto',
    autoModeEngine: 'rules',
    reasoningMode: 'deep',
    agentMode: 'sa',
  });
});

test('SessionRuntimeStore sanitizes writes to known runtime fields only', async () => {
  await store.set('s_runtime-2', {
    permissionMode: 'plan',
    sources: { permissionMode: 'explicit' },
  } as never);

  const filePath = path.join(tmpDir, 'runtime', 's_runtime-2.json');
  const raw = JSON.parse(await fs.readFile(filePath, 'utf-8')) as Record<string, unknown>;
  assert.equal(raw.permissionMode, 'plan');
  assert.equal(raw.sources, undefined);
  assert.deepEqual(await store.read('s_runtime-2'), { permissionMode: 'plan' });
});

test('SessionRuntimeStore ignores unsafe session ids', async () => {
  await store.set('../escape', { permissionMode: 'auto' });
  assert.equal(await store.read('../escape'), null);
});

test('SessionRuntimeStore serializes concurrent partial runtime writes', async () => {
  await Promise.all([
    store.set('s_runtime-concurrent', { permissionMode: 'auto' }),
    store.set('s_runtime-concurrent', { autoModeEngine: 'rules' }),
    store.set('s_runtime-concurrent', { reasoningMode: 'deep' }),
    store.set('s_runtime-concurrent', { agentMode: 'sa' }),
  ]);

  assert.deepEqual(await store.read('s_runtime-concurrent'), {
    permissionMode: 'auto',
    autoModeEngine: 'rules',
    reasoningMode: 'deep',
    agentMode: 'sa',
  });
});

test('SessionRuntimeStore rejects colon session ids to avoid Windows ADS paths', async () => {
  await store.set('s:ads', { permissionMode: 'auto' });

  assert.equal(await store.read('s:ads'), null);
});
