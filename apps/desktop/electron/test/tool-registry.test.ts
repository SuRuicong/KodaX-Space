// OC-21 ToolRegistry unit tests — pure function registry, no React deps.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerToolInputRenderer,
  getToolInputRenderer,
  listRegisteredToolInputRenderers,
  _clearToolInputRegistryForTesting,
  registerToolResultRenderer,
  getToolResultRenderer,
  listRegisteredToolResultRenderers,
  _clearToolResultRegistryForTesting,
} from '../../renderer/src/features/session/messages/toolRegistry.js';

beforeEach(() => {
  _clearToolInputRegistryForTesting();
  _clearToolResultRegistryForTesting();
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

// ---- v0.1.9 result-side registry ----

test('result: getToolResultRenderer returns null for unknown tool', () => {
  assert.equal(getToolResultRenderer('unknown_tool'), null);
});

test('result: register + lookup roundtrips', () => {
  const sentinel = (() => null) as never;
  registerToolResultRenderer('my_tool', sentinel);
  assert.equal(getToolResultRenderer('my_tool'), sentinel);
});

test('result: re-registering overwrites previous', () => {
  const first = (() => null) as never;
  const second = (() => null) as never;
  registerToolResultRenderer('overwrite_me', first);
  registerToolResultRenderer('overwrite_me', second);
  assert.equal(getToolResultRenderer('overwrite_me'), second);
});

test('result: listRegisteredToolResultRenderers returns sorted snapshot', () => {
  const noop = (() => null) as never;
  registerToolResultRenderer('zebra', noop);
  registerToolResultRenderer('alpha', noop);
  assert.deepEqual(listRegisteredToolResultRenderers(), ['alpha', 'zebra']);
});

test('result: snapshot is a fresh array (caller mutation does not affect registry)', () => {
  const noop = (() => null) as never;
  registerToolResultRenderer('a', noop);
  const snap = listRegisteredToolResultRenderers() as string[];
  snap.push('hacked');
  assert.deepEqual(listRegisteredToolResultRenderers(), ['a'], 'registry unaffected by caller push');
});

test('result: input and result registries are independent', () => {
  const ir = (() => null) as never;
  const rr = (() => null) as never;
  registerToolInputRenderer('shared', ir);
  registerToolResultRenderer('shared', rr);
  assert.equal(getToolInputRenderer('shared'), ir);
  assert.equal(getToolResultRenderer('shared'), rr);
  // wiping one doesn't affect the other
  _clearToolInputRegistryForTesting();
  assert.equal(getToolInputRenderer('shared'), null);
  assert.equal(getToolResultRenderer('shared'), rr);
});

test('result: renderer is invoked with toolName + result + input', () => {
  let calledWith: unknown = null;
  registerToolResultRenderer('probe', (args) => {
    calledWith = args;
    return null;
  });
  const r = getToolResultRenderer('probe');
  assert.ok(r);
  const result = r({ toolName: 'probe', result: 'output text', input: { cmd: 'ls' } });
  assert.equal(result, null);
  assert.deepEqual(calledWith, { toolName: 'probe', result: 'output text', input: { cmd: 'ls' } });
});
