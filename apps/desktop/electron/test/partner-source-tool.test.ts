import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensurePartnerSourceToolRegistered,
  makePartnerSourceReadHandler,
  PARTNER_SOURCE_READ_TOOL,
  _resetPartnerSourceToolRegistrationForTesting,
} from '../kodax/partner-source-tool.js';
import { PartnerSourceStore } from '../kodax/partner-source-store.js';
import { withSessionRunContext } from '../kodax/session-run-context.js';
import {
  _clearPartnerSpaceToolPoliciesForTesting,
  getPartnerSpaceToolPolicy,
  isPartnerToolAllowed,
} from '../kodax/partner-tools.js';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-source-tool-'));
  const root = join(dir, 'project');
  mkdirSync(root, { recursive: true });
  const store = new PartnerSourceStore(join(dir, 'partner-sources.json'));
  const handler = makePartnerSourceReadHandler({
    store,
    assertAllowedProjectRoot: async (projectRoot) => projectRoot,
  });
  return { dir, root, store, handler };
}

test('partner_source_read reads an attached file in a Partner run context', async () => {
  const { dir, root, store, handler } = harness();
  try {
    writeFileSync(join(root, 'notes.md'), '# Notes\nsource truth');
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: root,
      path: 'notes.md',
      targetKind: 'file',
    });
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot: root },
      () => handler({ sourceId: source.id }),
    );
    assert.match(out, /Source: src_/);
    assert.match(out, /# Notes/);
    assert.match(out, /source truth/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner_source_read can use SDK tool execution context without ALS', async () => {
  const { dir, root, store, handler } = harness();
  try {
    writeFileSync(join(root, 'notes.md'), '# Notes\nsource truth');
    const source = await store.addWorkspacePath({
      sessionId: 's_sdk',
      projectRoot: root,
      path: 'notes.md',
      targetKind: 'file',
    });
    const out = await handler(
      { sourceId: source.id },
      {
        sessionId: 's_sdk',
        executionCwd: root,
        agentProfile: { surface: 'partner', id: 'kodax-space.partner' },
      },
    );
    assert.match(out, /# Notes/);
    assert.match(out, /source truth/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});


test('partner_source_read returns a bounded tree for directory sources', async () => {
  const { dir, root, store, handler } = harness();
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'spec.md'), 'spec');
    const source = await store.addWorkspacePath({
      sessionId: 's1',
      projectRoot: root,
      path: 'docs',
      targetKind: 'dir',
    });
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'partner', projectRoot: root },
      () => handler({ sourceId: source.id }),
    );
    assert.match(out, /Kind: directory/);
    assert.match(out, /docs\/spec.md/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partner_source_read refuses calls outside Partner run context', async () => {
  const { dir, store, handler } = harness();
  try {
    assert.match(await handler({ sourceId: 'src_missing' }), /outside an active session run/);
    const out = await withSessionRunContext(
      { sessionId: 's1', surface: 'code', projectRoot: dir },
      () => handler({ sourceId: 'src_missing' }),
    );
    assert.match(out, /only available in Partner/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensurePartnerSourceToolRegistered registers once and publishes Partner policy', () => {
  _resetPartnerSourceToolRegistrationForTesting();
  _clearPartnerSpaceToolPoliciesForTesting();
  let calls = 0;
  const sdk = { registerTool: () => { calls++; return () => {}; } };
  ensurePartnerSourceToolRegistered(sdk);
  ensurePartnerSourceToolRegistered(sdk);
  assert.equal(calls, 1);
  assert.equal(getPartnerSpaceToolPolicy('partner_source_read')?.scope, 'source');
  assert.equal(
    isPartnerToolAllowed('partner_source_read', 'subagent', { sideEffect: 'readonly' }),
    true,
  );
  _clearPartnerSpaceToolPoliciesForTesting();
});

test('PARTNER_SOURCE_READ_TOOL shape is readonly and sourceId-based', () => {
  assert.equal(PARTNER_SOURCE_READ_TOOL.name, 'partner_source_read');
  assert.equal(PARTNER_SOURCE_READ_TOOL.sideEffect, 'readonly');
  assert.deepEqual(PARTNER_SOURCE_READ_TOOL.input_schema.required, ['sourceId']);
});
