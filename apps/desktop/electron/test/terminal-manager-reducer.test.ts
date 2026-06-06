// F023 — TerminalManager reducer unit tests.
// Pure function, no React; exercises tab lifecycle invariants.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialTabsState,
  tabsReducer,
  MAX_TABS,
} from '../../renderer/src/features/terminal/tabsReducer.js';

const MAX_TABS_FOR_TEST = MAX_TABS;

test('initial state: 1 tab, counter=1, active=tab-1', () => {
  const s = initialTabsState();
  assert.equal(s.tabs.length, 1);
  assert.equal(s.tabs[0]!.id, 'tab-1');
  assert.equal(s.tabs[0]!.label, 'Terminal 1');
  assert.equal(s.activeId, 'tab-1');
  assert.equal(s.counter, 1);
});

test('ADD: appends a tab and activates it', () => {
  const s0 = initialTabsState();
  const s1 = tabsReducer(s0, { type: 'ADD' });
  assert.equal(s1.tabs.length, 2);
  assert.equal(s1.tabs[1]!.id, 'tab-2');
  assert.equal(s1.tabs[1]!.label, 'Terminal 2');
  assert.equal(s1.activeId, 'tab-2', 'new tab becomes active');
  assert.equal(s1.counter, 2);
});

test('ADD: monotonic counter — never reuses id', () => {
  let s = initialTabsState();
  for (let i = 0; i < 5; i++) {
    s = tabsReducer(s, { type: 'ADD' });
  }
  // counter=6; tab ids are tab-1..tab-6
  assert.equal(s.tabs.length, 6);
  assert.equal(s.counter, 6);
  const ids = s.tabs.map((t) => t.id);
  assert.deepEqual(ids, ['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5', 'tab-6']);
});

test('ADD: refuses past MAX_TABS — state unchanged', () => {
  let s = initialTabsState();
  for (let i = 1; i < MAX_TABS_FOR_TEST; i++) {
    s = tabsReducer(s, { type: 'ADD' });
  }
  assert.equal(s.tabs.length, MAX_TABS_FOR_TEST);
  const sBefore = s;
  const sAfter = tabsReducer(s, { type: 'ADD' });
  assert.strictEqual(sAfter, sBefore, 'returns same reference when capped');
});

test('CLOSE: non-active tab — removes it, keeps active', () => {
  let s = initialTabsState();
  s = tabsReducer(s, { type: 'ADD' }); // active=tab-2
  s = tabsReducer(s, { type: 'CLOSE', tabId: 'tab-1' });
  assert.equal(s.tabs.length, 1);
  assert.equal(s.tabs[0]!.id, 'tab-2');
  assert.equal(s.activeId, 'tab-2');
});

test('CLOSE: active tab in middle — switches to right neighbor', () => {
  let s = initialTabsState();
  s = tabsReducer(s, { type: 'ADD' }); // tab-2
  s = tabsReducer(s, { type: 'ADD' }); // tab-3 active
  s = tabsReducer(s, { type: 'ACTIVATE', tabId: 'tab-2' });
  s = tabsReducer(s, { type: 'CLOSE', tabId: 'tab-2' });
  assert.equal(s.activeId, 'tab-3', 'closes tab-2 (idx=1), idx clamps to 1 → tab-3');
});

test('CLOSE: active last tab — switches to new last', () => {
  let s = initialTabsState();
  s = tabsReducer(s, { type: 'ADD' });
  s = tabsReducer(s, { type: 'ADD' });
  // active=tab-3 (last)
  s = tabsReducer(s, { type: 'CLOSE', tabId: 'tab-3' });
  assert.equal(s.activeId, 'tab-2');
});

test('CLOSE: last remaining tab — spawns a fresh tab automatically', () => {
  let s = initialTabsState();
  const counterBefore = s.counter;
  s = tabsReducer(s, { type: 'CLOSE', tabId: 'tab-1' });
  assert.equal(s.tabs.length, 1, 'replacement tab spawned');
  assert.equal(s.counter, counterBefore + 1, 'counter advanced');
  assert.equal(s.tabs[0]!.id, `tab-${counterBefore + 1}`);
  assert.equal(s.activeId, s.tabs[0]!.id);
});

test('CLOSE: unknown tabId — state unchanged', () => {
  const s0 = initialTabsState();
  const s1 = tabsReducer(s0, { type: 'CLOSE', tabId: 'tab-999' });
  // CLOSE on unknown id returns a state with same tabs but possibly new ref;
  // verify tab list is identical
  assert.deepEqual(s1.tabs, s0.tabs);
  assert.equal(s1.activeId, s0.activeId);
});

test('ACTIVATE: switches activeId', () => {
  let s = initialTabsState();
  s = tabsReducer(s, { type: 'ADD' });
  s = tabsReducer(s, { type: 'ACTIVATE', tabId: 'tab-1' });
  assert.equal(s.activeId, 'tab-1');
});

test('ACTIVATE: same tab — returns same reference (no re-render trigger)', () => {
  const s0 = initialTabsState();
  const s1 = tabsReducer(s0, { type: 'ACTIVATE', tabId: 'tab-1' });
  assert.strictEqual(s1, s0);
});

test('ACTIVATE: non-existent tab — state unchanged (race guard)', () => {
  const s0 = initialTabsState();
  const s1 = tabsReducer(s0, { type: 'ACTIVATE', tabId: 'tab-999' });
  assert.strictEqual(s1, s0);
});
