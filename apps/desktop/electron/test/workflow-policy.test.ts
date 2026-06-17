// F064 — WorkflowPolicyStore: 默认 / normalize+clamp（硬上限）/ 持久化往返。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkflowPolicyStore,
  normalizeWorkflowPolicy,
  DEFAULT_WORKFLOW_POLICY,
} from '../kodax/workflow-policy.js';

function freshFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wf-policy-'));
  return { dir, file: join(dir, 'workflow-policy.json') };
}

test('default policy: autoStart=confirm, conservative caps', () => {
  assert.equal(DEFAULT_WORKFLOW_POLICY.autoStart, 'confirm');
  assert.ok(DEFAULT_WORKFLOW_POLICY.maxAgents <= 64);
  assert.ok(DEFAULT_WORKFLOW_POLICY.maxConcurrency <= 16);
  assert.ok(DEFAULT_WORKFLOW_POLICY.tokenBudget <= 200_000);
});

test('normalize clamps caps to hard ceiling + coerces invalid autoStart', () => {
  const p = normalizeWorkflowPolicy({
    autoStart: 'bogus' as never,
    maxAgents: 9999,
    maxConcurrency: 9999,
    tokenBudget: 9_999_999,
  });
  assert.equal(p.autoStart, 'confirm'); // 非法 → 默认
  assert.equal(p.maxAgents, 64);
  assert.equal(p.maxConcurrency, 16);
  assert.equal(p.tokenBudget, 200_000);
});

test('normalize floors caps at >=1 and ignores non-numeric', () => {
  const p = normalizeWorkflowPolicy({ maxAgents: 0, maxConcurrency: -5, tokenBudget: 'x' as never });
  assert.equal(p.maxAgents, 1);
  assert.equal(p.maxConcurrency, 1);
  assert.equal(p.tokenBudget, DEFAULT_WORKFLOW_POLICY.tokenBudget); // 非数字 → 默认
});

test('get returns defaults before load; set persists clamped value', async () => {
  const { dir, file } = freshFile();
  try {
    const store = new WorkflowPolicyStore(file);
    assert.deepEqual(store.get(), DEFAULT_WORKFLOW_POLICY); // 未 load
    const next = await store.set({ autoStart: 'on', maxAgents: 999 });
    assert.equal(next.autoStart, 'on');
    assert.equal(next.maxAgents, 64); // clamped
    await store.flush();

    // 新实例同文件 → 读回持久化值
    const store2 = new WorkflowPolicyStore(file);
    const loaded = await store2.load();
    assert.equal(loaded.autoStart, 'on');
    assert.equal(loaded.maxAgents, 64);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('set merges partial patch onto current (other fields unchanged)', async () => {
  const { dir, file } = freshFile();
  try {
    const store = new WorkflowPolicyStore(file);
    await store.set({ maxConcurrency: 4 });
    const after = await store.set({ autoStart: 'off' });
    assert.equal(after.autoStart, 'off');
    assert.equal(after.maxConcurrency, 4); // 保留上次的
    await store.flush();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
