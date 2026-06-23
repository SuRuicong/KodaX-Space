import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSessionSendScope } from '../ipc/session.js';

const codeSession = {
  sessionId: 's_code',
  projectRoot: '/Users/vincegao/project-a',
  surface: 'code' as const,
};

test('assertSessionSendScope accepts matching project and surface', () => {
  assert.doesNotThrow(() =>
    assertSessionSendScope(codeSession, {
      expectedProjectRoot: '/Users/vincegao/project-a/',
      expectedSurface: 'code',
    }),
  );
});

test('assertSessionSendScope rejects stale project root', () => {
  assert.throws(
    () =>
      assertSessionSendScope(codeSession, {
        expectedProjectRoot: '/Users/vincegao/project-b',
        expectedSurface: 'code',
      }),
    /session\/project mismatch/,
  );
});

test('assertSessionSendScope rejects stale surface', () => {
  assert.throws(
    () =>
      assertSessionSendScope(codeSession, {
        expectedProjectRoot: '/Users/vincegao/project-a',
        expectedSurface: 'partner',
      }),
    /session\/surface mismatch/,
  );
});

test('assertSessionSendScope remains backward compatible when no expected scope is supplied', () => {
  assert.doesNotThrow(() => assertSessionSendScope(codeSession, {}));
});