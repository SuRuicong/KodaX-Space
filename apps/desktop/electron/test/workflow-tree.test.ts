// F061 — buildItemTree: 把 WorkflowProcessSnapshot.items[] 扁平表构造成 phase/agent/step 森林。
// 纯函数(只 import type),放这里复用 electron/test 的 node --test harness。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItemTree } from '../../renderer/src/features/workflow/buildItemTree.js';
import type { WorkflowProcessItemT } from '@kodax-space/space-ipc-schema';

function item(over: Partial<WorkflowProcessItemT> & { id: string }): WorkflowProcessItemT {
  return { title: over.id, kind: 'step', status: 'pending', ...over };
}

test('flat phases become roots in input order', () => {
  const tree = buildItemTree([
    item({ id: 'p1', kind: 'phase' }),
    item({ id: 'p2', kind: 'phase' }),
  ]);
  assert.equal(tree.length, 2);
  assert.deepEqual(
    tree.map((n) => n.item.id),
    ['p1', 'p2'],
  );
  assert.equal(tree[0]?.children.length, 0);
});

test('agent nests under phase via phaseId; step nests under agent via parentId', () => {
  const tree = buildItemTree([
    item({ id: 'p1', kind: 'phase' }),
    item({ id: 'a1', kind: 'agent', phaseId: 'p1' }),
    item({ id: 's1', kind: 'step', parentId: 'a1' }),
  ]);
  assert.equal(tree.length, 1);
  const p1 = tree[0]!;
  assert.equal(p1.item.id, 'p1');
  assert.equal(p1.children.length, 1);
  const a1 = p1.children[0]!;
  assert.equal(a1.item.id, 'a1');
  assert.equal(a1.children[0]?.item.id, 's1');
});

test('parentId wins over phaseId when both set', () => {
  const tree = buildItemTree([
    item({ id: 'p1', kind: 'phase' }),
    item({ id: 'a1', kind: 'agent', phaseId: 'p1' }),
    // child references a1 via parentId but also has phaseId p1 — parentId wins
    item({ id: 'c1', parentId: 'a1', phaseId: 'p1' }),
  ]);
  const p1 = tree[0]!;
  assert.equal(p1.children.length, 1); // only a1 directly under p1
  assert.equal(p1.children[0]?.item.id, 'a1');
  assert.equal(p1.children[0]?.children[0]?.item.id, 'c1'); // c1 under a1, not p1
});

test('orphan (parent id not found) becomes a root', () => {
  const tree = buildItemTree([item({ id: 'x', parentId: 'ghost' })]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.item.id, 'x');
});

test('cycle a→b→a is broken (no infinite loop), both surface as reachable nodes', () => {
  const tree = buildItemTree([
    item({ id: 'a', parentId: 'b' }),
    item({ id: 'b', parentId: 'a' }),
  ]);
  // 第一个连边 a→b 成功(b 此时无父);b→a 会成环被断 → b 变 root，a 挂 b 下。
  // 关键断言:不爆栈、所有节点都在、总节点数=2。
  const flat: string[] = [];
  const walk = (ns: typeof tree): void => {
    for (const n of ns) {
      flat.push(n.item.id);
      walk(n.children);
    }
  };
  walk(tree);
  assert.deepEqual([...flat].sort(), ['a', 'b']);
});

test('duplicate id: first wins, later ignored (no duplicate nodes)', () => {
  const tree = buildItemTree([
    item({ id: 'p', kind: 'phase', title: 'first' }),
    item({ id: 'p', kind: 'phase', title: 'dupe' }),
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.item.title, 'first');
});

test('empty input → empty forest', () => {
  assert.deepEqual(buildItemTree([]), []);
});
