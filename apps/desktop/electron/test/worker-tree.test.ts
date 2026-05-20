// FEATURE_037: buildWorkerTree pure-function tests.
//
// 不依赖 DOM / electron / React——纯函数 unit。
// 文件位于 electron/test/ 让现有 test runner 直接覆盖；renderer 没有独立 test runner。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkerTree,
  MAIN_WORKER_ID,
  MAIN_WORKER_TITLE,
} from '../../renderer/src/shell/popouts/worker-tree.js';

type Status = Parameters<typeof buildWorkerTree>[0];

function makeStatus(over: Partial<NonNullable<Status>> = {}): NonNullable<Status> {
  return {
    agentMode: 'ama',
    harnessProfile: 'H0_DIRECT',
    ...over,
  };
}

test('buildWorkerTree: undefined status → empty array', () => {
  assert.deepEqual(buildWorkerTree(undefined), []);
});

test('buildWorkerTree: empty events + no activeWorker → empty array', () => {
  const status = makeStatus({ events: [] });
  assert.deepEqual(buildWorkerTree(status), []);
});

test('buildWorkerTree: active worker without events still gets a node', () => {
  const status = makeStatus({
    activeWorkerId: 'w1',
    activeWorkerTitle: 'Worker 1',
    events: [],
  });
  const tree = buildWorkerTree(status);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].workerId, 'w1');
  assert.equal(tree[0].workerTitle, 'Worker 1');
  assert.equal(tree[0].isActive, true);
  assert.equal(tree[0].events.length, 0);
  assert.equal(tree[0].latestKind, undefined);
});

test('buildWorkerTree: events without workerId fall into main agent bucket', () => {
  const status = makeStatus({
    events: [
      { key: 'e1', kind: 'progress', summary: 'thinking…' },
      { key: 'e2', kind: 'completed', summary: 'done' },
    ],
  });
  const tree = buildWorkerTree(status);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].workerId, MAIN_WORKER_ID);
  assert.equal(tree[0].workerTitle, MAIN_WORKER_TITLE);
  assert.equal(tree[0].isMain, true);
  assert.equal(tree[0].events.length, 2);
  assert.equal(tree[0].latestKind, 'completed');
});

test('buildWorkerTree: groups events by workerId; preserves event order', () => {
  const status = makeStatus({
    activeWorkerId: 'w2',
    activeWorkerTitle: 'Active Worker',
    events: [
      { key: 'a1', kind: 'progress', workerId: 'w1', workerTitle: 'W1', summary: 's1' },
      { key: 'a2', kind: 'progress', workerId: 'w2', workerTitle: 'W2', summary: 's2' },
      { key: 'a3', kind: 'completed', workerId: 'w1', workerTitle: 'W1', summary: 's3' },
      { key: 'a4', kind: 'warning', workerId: 'w2', workerTitle: 'W2', summary: 's4' },
    ],
  });
  const tree = buildWorkerTree(status);
  assert.equal(tree.length, 2);
  // Active first
  assert.equal(tree[0].workerId, 'w2');
  assert.equal(tree[0].isActive, true);
  assert.deepEqual(
    tree[0].events.map((e) => e.key),
    ['a2', 'a4'],
    'event order within bucket preserved',
  );
  assert.equal(tree[0].latestKind, 'warning');
  // Non-active
  assert.equal(tree[1].workerId, 'w1');
  assert.equal(tree[1].isActive, false);
  assert.deepEqual(tree[1].events.map((e) => e.key), ['a1', 'a3']);
});

test('buildWorkerTree: sort priority — warning > progress > notification > completed', () => {
  const status = makeStatus({
    // 没 active — 让排序权重 = latestKind priority
    events: [
      { key: 'c', kind: 'completed', workerId: 'wcomp', workerTitle: 'C', summary: '' },
      { key: 'n', kind: 'notification', workerId: 'wnoti', workerTitle: 'N', summary: '' },
      { key: 'p', kind: 'progress', workerId: 'wprog', workerTitle: 'P', summary: '' },
      { key: 'w', kind: 'warning', workerId: 'wwarn', workerTitle: 'W', summary: '' },
    ],
  });
  const ids = buildWorkerTree(status).map((n) => n.workerId);
  assert.deepEqual(ids, ['wwarn', 'wprog', 'wnoti', 'wcomp']);
});

test('buildWorkerTree: workerTitle fallback to workerId when not provided', () => {
  const status = makeStatus({
    events: [
      // workerTitle 第一个事件缺失，第二个提供 → 取后者（KodaX 常见模式）
      { key: 'e1', kind: 'progress', workerId: 'wxyz', summary: '' },
      { key: 'e2', kind: 'completed', workerId: 'wxyz', workerTitle: 'Late Title', summary: '' },
    ],
  });
  const tree = buildWorkerTree(status);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].workerTitle, 'Late Title');
});

test('buildWorkerTree: activeWorkerId in events list still gets isActive=true', () => {
  const status = makeStatus({
    activeWorkerId: 'wA',
    activeWorkerTitle: 'A',
    events: [
      { key: 'e1', kind: 'progress', workerId: 'wA', workerTitle: 'A', summary: 'working' },
      { key: 'e2', kind: 'completed', workerId: 'wB', workerTitle: 'B', summary: 'done' },
    ],
  });
  const tree = buildWorkerTree(status);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].workerId, 'wA');
  assert.equal(tree[0].isActive, true);
  assert.equal(tree[1].workerId, 'wB');
  assert.equal(tree[1].isActive, false);
});

test('buildWorkerTree: latestPhase / latestSummary from last event in bucket', () => {
  const status = makeStatus({
    events: [
      { key: 'e1', kind: 'progress', workerId: 'w', workerTitle: 'W', phase: 'plan', summary: 'planning' },
      { key: 'e2', kind: 'progress', workerId: 'w', workerTitle: 'W', phase: 'exec', summary: 'executing' },
    ],
  });
  const tree = buildWorkerTree(status);
  assert.equal(tree[0].latestPhase, 'exec');
  assert.equal(tree[0].latestSummary, 'executing');
});

// ---- Reviewer F037 regression tests ----

test('buildWorkerTree: empty-string workerId routes to MAIN bucket (HIGH-1)', () => {
  const status = makeStatus({
    events: [
      { key: 'e1', kind: 'progress', workerId: '', summary: 's1' },
      { key: 'e2', kind: 'progress', summary: 's2' }, // undefined
    ],
  });
  const tree = buildWorkerTree(status);
  assert.equal(tree.length, 1, 'both events should merge into main bucket');
  assert.equal(tree[0].isMain, true);
  assert.equal(tree[0].events.length, 2);
});

test('buildWorkerTree: MAIN sentinel is namespaced (MEDIUM-1)', () => {
  // sentinel 不能是 '__main__' 这种普通字符串——避免 KodaX 真的 emit 一个叫 __main__
  // 的 worker 时跟我们 main bucket 撞 ID。
  assert.ok(MAIN_WORKER_ID.includes('kodax-space'), 'sentinel must be namespaced');
});

test('buildWorkerTree: tie-break by workerId when title + kind 同 (LOW-2)', () => {
  const status = makeStatus({
    events: [
      { key: 'a', kind: 'completed', workerId: 'w-bbb', workerTitle: 'Same Title', summary: '' },
      { key: 'b', kind: 'completed', workerId: 'w-aaa', workerTitle: 'Same Title', summary: '' },
    ],
  });
  const tree = buildWorkerTree(status);
  // 排序应当稳定且确定：w-aaa < w-bbb
  assert.equal(tree[0].workerId, 'w-aaa');
  assert.equal(tree[1].workerId, 'w-bbb');
});

test('buildWorkerTree: active worker without title falls back to "Worker" not raw ID (LOW-1)', () => {
  const status = makeStatus({
    activeWorkerId: 'wrk_01abcdef12345',
    // 不传 activeWorkerTitle
    events: [],
  });
  const tree = buildWorkerTree(status);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].workerTitle, 'Worker', 'should not surface raw UUID-ish ID as title');
});
