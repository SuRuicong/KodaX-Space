// OC-21 ToolRegistry unit tests — pure function registry, no React deps.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerToolInputRenderer,
  getToolInputRenderer,
  listRegisteredToolInputRenderers,
  _clearToolInputRegistryForTesting,
} from '../../renderer/src/features/session/messages/toolRegistry.js';

beforeEach(() => {
  _clearToolInputRegistryForTesting();
});

test('getToolInputRenderer returns null for unknown tool', () => {
  assert.equal(getToolInputRenderer('unknown_tool'), null);
});

test('register + lookup roundtrips', () => {
  const sentinel = (() => null) as never;
  registerToolInputRenderer('my_tool', sentinel);
  assert.equal(getToolInputRenderer('my_tool'), sentinel);
});

test('re-registering same name overwrites the previous renderer', () => {
  const first = (() => null) as never;
  const second = (() => null) as never;
  registerToolInputRenderer('overwrite_me', first);
  registerToolInputRenderer('overwrite_me', second);
  assert.equal(getToolInputRenderer('overwrite_me'), second);
});

test('listRegisteredToolInputRenderers returns sorted names snapshot', () => {
  const noop = (() => null) as never;
  registerToolInputRenderer('zebra', noop);
  registerToolInputRenderer('alpha', noop);
  registerToolInputRenderer('mango', noop);
  assert.deepEqual(listRegisteredToolInputRenderers(), ['alpha', 'mango', 'zebra']);
});

test('snapshot list is a fresh array (caller mutation does not affect registry)', () => {
  const noop = (() => null) as never;
  registerToolInputRenderer('a', noop);
  const snap = listRegisteredToolInputRenderers() as string[];
  snap.push('hacked');
  assert.deepEqual(listRegisteredToolInputRenderers(), ['a'], 'registry unaffected by caller push');
});

test('_clearToolInputRegistryForTesting wipes all entries', () => {
  const noop = (() => null) as never;
  registerToolInputRenderer('x', noop);
  registerToolInputRenderer('y', noop);
  _clearToolInputRegistryForTesting();
  assert.equal(listRegisteredToolInputRenderers().length, 0);
});

test('renderer is invoked with the expected args shape and may return null', () => {
  let calledWith: unknown = null;
  registerToolInputRenderer('probe', (args) => {
    calledWith = args;
    return null;
  });
  const r = getToolInputRenderer('probe');
  assert.ok(r, 'renderer registered');
  // Invoking returns null per the registered function
  const result = r({ toolName: 'probe', input: { foo: 'bar' } });
  assert.equal(result, null);
  assert.deepEqual(calledWith, { toolName: 'probe', input: { foo: 'bar' } });
});
