// F058 — create_artifact tool: handler logic (attribution via run-context ALS,
// store integration, validation), tool-def shape, Partner allow. The end-to-end
// "agent actually calls it" path needs a real LLM session (e2e/real-glm-session
// style) — these cover everything below that boundary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../artifact/store.js';
import { withArtifactContext } from '../artifact/run-context.js';
import {
  makeCreateArtifactHandler,
  CREATE_ARTIFACT_TOOL,
  ensureCreateArtifactToolRegistered,
  _resetCreateArtifactRegistrationForTesting,
} from '../artifact/create-artifact-tool.js';
import { isPartnerToolAllowed, PARTNER_SPACE_TOOL_ALLOW } from '../kodax/partner-tools.js';

function freshStore(): { store: ArtifactStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'create-artifact-tool-'));
  return { store: new ArtifactStore(join(dir, 'artifacts.json'), dir), dir };
}

function harness() {
  const { store, dir } = freshStore();
  const changes: Array<{ id: string; sessionId: string; reason: string }> = [];
  const handler = makeCreateArtifactHandler({ store, notifyChanged: (p) => changes.push(p) });
  return { store, dir, changes, handler };
}

const CTX = { sessionId: 's1', surface: 'partner' as const, projectRoot: '/proj' };

test('handler: creates a markdown artifact within run context + notifies', async () => {
  const { store, dir, changes, handler } = harness();
  try {
    const out = await withArtifactContext(CTX, () =>
      handler({ kind: 'markdown', title: 'Report', content: '# hi' }),
    );
    assert.match(out, /created/i);
    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.sessionId, 's1');
    assert.equal(list[0]?.surface, 'partner');
    assert.equal(changes.length, 1);
    assert.equal(changes[0]?.reason, 'created');
    assert.equal(changes[0]?.sessionId, 's1'); // attributed from ALS, not tool input
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: artifactId appends a version (reason=version)', async () => {
  const { store, dir, changes, handler } = harness();
  try {
    await withArtifactContext(CTX, () => handler({ kind: 'markdown', title: 'R', content: 'v1' }));
    const id = (await store.list())[0]!.id;
    const out = await withArtifactContext(CTX, () =>
      handler({ kind: 'markdown', title: 'R', content: 'v2', artifactId: id }),
    );
    assert.match(out, /updated/i);
    assert.equal((await store.list())[0]?.currentVersion, 2);
    assert.equal(changes[1]?.reason, 'version');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: refuses when called outside a run context (no attribution)', async () => {
  const { store, dir, handler } = harness();
  try {
    const out = await handler({ kind: 'markdown', title: 'R', content: 'x' }); // no withArtifactContext
    assert.match(out, /outside an active session run/i);
    assert.equal((await store.list()).length, 0);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: rejects the gated react tier', async () => {
  const { store, dir, handler } = harness();
  try {
    const out = await withArtifactContext(CTX, () =>
      handler({ kind: 'react', title: 'X', content: 'export default()=>null' }),
    );
    assert.match(out, /not available/i);
    assert.equal((await store.list()).length, 0);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: invalid payload (markdown without content) → error, no write', async () => {
  const { store, dir, handler } = harness();
  try {
    const out = await withArtifactContext(CTX, () => handler({ kind: 'markdown', title: 'X' }));
    assert.match(out, /invalid artifact input/i);
    assert.equal((await store.list()).length, 0);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: doc kind with path works', async () => {
  const { store, dir, handler } = harness();
  try {
    const out = await withArtifactContext(CTX, () =>
      handler({ kind: 'pdf', title: 'Doc', path: '/proj/a.pdf' }),
    );
    assert.match(out, /created/i);
    const read = await store.read((await store.list())[0]!.id);
    assert.equal(read?.path, '/proj/a.pdf');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handler: doc path outside the project is rejected', async () => {
  const { store, dir, handler } = harness();
  try {
    const out = await withArtifactContext(CTX, () =>
      handler({ kind: 'pdf', title: 'Doc', path: '/etc/passwd' }),
    );
    assert.match(out, /inside the project/i);
    assert.equal((await store.list()).length, 0);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- registration path ----

test('ensureCreateArtifactToolRegistered: idempotent (registers once)', () => {
  _resetCreateArtifactRegistrationForTesting();
  let calls = 0;
  const sdk = { registerTool: () => { calls++; return () => {}; } };
  ensureCreateArtifactToolRegistered(sdk);
  ensureCreateArtifactToolRegistered(sdk);
  assert.equal(calls, 1);
});

test('ensureCreateArtifactToolRegistered: no registerTool → soft no-op, can retry later', () => {
  _resetCreateArtifactRegistrationForTesting();
  ensureCreateArtifactToolRegistered({}); // missing registerTool
  let calls = 0;
  ensureCreateArtifactToolRegistered({ registerTool: () => { calls++; return () => {}; } });
  assert.equal(calls, 1); // flag wasn't locked by the failed attempt
});

test('ensureCreateArtifactToolRegistered: throwing reg() does not lock out retry', () => {
  _resetCreateArtifactRegistrationForTesting();
  assert.throws(() =>
    ensureCreateArtifactToolRegistered({ registerTool: () => { throw new Error('boom'); } }),
  );
  let calls = 0;
  ensureCreateArtifactToolRegistered({ registerTool: () => { calls++; return () => {}; } });
  assert.equal(calls, 1); // retried successfully after the throw
});

// ---- tool definition shape + Partner allow ----

test('CREATE_ARTIFACT_TOOL: shape + react excluded + mutates-state', () => {
  assert.equal(CREATE_ARTIFACT_TOOL.name, 'create_artifact');
  assert.equal(CREATE_ARTIFACT_TOOL.sideEffect, 'mutates-state');
  assert.deepEqual(CREATE_ARTIFACT_TOOL.input_schema.required, ['kind', 'title']);
  const kinds = (CREATE_ARTIFACT_TOOL.input_schema.properties.kind as { enum: string[] }).enum;
  assert.ok(kinds.includes('markdown') && kinds.includes('chart'));
  assert.ok(!kinds.includes('react')); // static tier only
});

test('Partner allows create_artifact even though its capability is non-read', () => {
  assert.ok(PARTNER_SPACE_TOOL_ALLOW.has('create_artifact'));
  // resolveToolCapability fail-closes unknown custom tools to 'subagent'
  assert.equal(isPartnerToolAllowed('create_artifact', 'subagent'), true);
  assert.equal(isPartnerToolAllowed('some_other_tool', 'subagent'), false);
});
