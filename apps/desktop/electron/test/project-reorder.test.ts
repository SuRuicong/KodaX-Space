// v0.1.9 Step 7 — projectOrder reorder logic tests.
//
// 直接 import store 测 reorderProjects 行为 — 不挂 React,只跑 set/get。这是
// pure reducer 逻辑,不需要 renderer runtime。

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import type { Project } from '@kodax-space/space-ipc-schema';

// localStorage shim — node 没有 window;store 内部 lsGet/lsSet 会 fallthrough 到 try/catch
// 静默处理。这里不需要真持久化(每个 test 独立 setProjectOrder 即可)。

function mkProject(path: string, lastUsedAt: number, name?: string): Project {
  return {
    path,
    name: name ?? path.split(/[\\/]/).pop() ?? path,
    addedAt: lastUsedAt,
    lastUsedAt,
  };
}

// 把 store 重置到 known state — 不重建 store (zustand 模块级单例),只设需要的字段。
function resetStore(projects: Project[], order: readonly string[]): void {
  useAppStore.setState({
    projects,
    projectOrder: order,
  });
}

beforeEach(() => {
  resetStore([], []);
});

test('reorderProjects: no-op when src === target', () => {
  const a = mkProject('/proj/a', 100);
  const b = mkProject('/proj/b', 200);
  resetStore([a, b], []);
  useAppStore.getState().reorderProjects('/proj/a', '/proj/a');
  // order 没被写
  assert.deepEqual(useAppStore.getState().projectOrder, []);
});

test('reorderProjects: moves src to before target (basic case)', () => {
  const a = mkProject('/proj/a', 100);
  const b = mkProject('/proj/b', 200);
  const c = mkProject('/proj/c', 300);
  // 当前 order 空,active 列表按 store 顺序 = [a, b, c]
  resetStore([a, b, c], []);
  // 把 c 拖到 a 之前
  useAppStore.getState().reorderProjects('/proj/c', '/proj/a');
  assert.deepEqual(useAppStore.getState().projectOrder, [
    '/proj/c',
    '/proj/a',
    '/proj/b',
  ]);
});

test('reorderProjects: target after src — index shifts down by 1', () => {
  const a = mkProject('/proj/a', 100);
  const b = mkProject('/proj/b', 200);
  const c = mkProject('/proj/c', 300);
  resetStore([a, b, c], []);
  // 把 a 拖到 c 之前 (a 在 c 前面 → src 走后 target 索引减 1)
  useAppStore.getState().reorderProjects('/proj/a', '/proj/c');
  assert.deepEqual(useAppStore.getState().projectOrder, [
    '/proj/b',
    '/proj/a',
    '/proj/c',
  ]);
});

test('reorderProjects: respects existing order — only swaps the two involved', () => {
  const a = mkProject('/a', 100);
  const b = mkProject('/b', 200);
  const c = mkProject('/c', 300);
  const d = mkProject('/d', 400);
  resetStore([a, b, c, d], ['/a', '/b', '/c', '/d']);
  // 把 c 拖到 a 之前
  useAppStore.getState().reorderProjects('/c', '/a');
  assert.deepEqual(useAppStore.getState().projectOrder, [
    '/c',
    '/a',
    '/b',
    '/d',
  ]);
});

test('reorderProjects: filters out archived / removed projects from prior order', () => {
  const a = mkProject('/a', 100);
  const b = mkProject('/b', 200);
  // c 不在 active (archived),d 在 prior order 但被删了
  const c = { ...mkProject('/c', 300), archived: true };
  resetStore([a, b, c], ['/a', '/c', '/d', '/b']);
  // 用户拖 a 到 b 前
  useAppStore.getState().reorderProjects('/a', '/b');
  // prior order 里的 '/c' (archived) + '/d' (gone) 都被过滤掉,只保留有效 active
  assert.deepEqual(useAppStore.getState().projectOrder, ['/a', '/b']);
});

test('reorderProjects: appends never-seen projects to tail', () => {
  const a = mkProject('/a', 100);
  const b = mkProject('/b', 200);
  const c = mkProject('/c', 300);
  // prior order 只有 a + b,c 是新项目
  resetStore([a, b, c], ['/a', '/b']);
  // 把 c 拖到 a 之前 (c 在 prior 里没出现 → 先以 tail 合入,然后再处理 reorder)
  useAppStore.getState().reorderProjects('/c', '/a');
  assert.deepEqual(useAppStore.getState().projectOrder, ['/c', '/a', '/b']);
});

test('reorderProjects: no-op when src not in active list', () => {
  const a = mkProject('/a', 100);
  resetStore([a], []);
  useAppStore.getState().reorderProjects('/ghost', '/a');
  assert.deepEqual(useAppStore.getState().projectOrder, []);
});

test('reorderProjects: no-op when target not in active list', () => {
  const a = mkProject('/a', 100);
  resetStore([a], []);
  useAppStore.getState().reorderProjects('/a', '/ghost');
  assert.deepEqual(useAppStore.getState().projectOrder, []);
});

test('reorderProjects: moving src to its own current neighbor still produces valid order', () => {
  const a = mkProject('/a', 100);
  const b = mkProject('/b', 200);
  resetStore([a, b], ['/a', '/b']);
  // a 在 b 前 → 把 a 拖到 b 前 = no-effective-change(src 拿掉后 target=b 索引 0,插入 b 前 still [a, b])
  useAppStore.getState().reorderProjects('/a', '/b');
  assert.deepEqual(useAppStore.getState().projectOrder, ['/a', '/b']);
});
