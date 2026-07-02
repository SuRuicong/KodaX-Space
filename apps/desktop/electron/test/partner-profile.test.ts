import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPartnerAgentProfile,
  buildPartnerToolPolicySummary,
  buildPartnerSourceSummary,
  buildPartnerPromptOverlay,
  PARTNER_AGENT_PROFILE,
  PARTNER_PROFILE_INSTRUCTIONS,
} from '../kodax/partner-profile.js';
import {
  _clearPartnerSpaceToolPoliciesForTesting,
  registerPartnerSpaceToolPolicy,
} from '../kodax/partner-tools.js';

test('Partner agent profile steers knowledge work without leaving managed task harness', () => {
  _clearPartnerSpaceToolPoliciesForTesting();
  const profile = buildPartnerAgentProfile();
  assert.deepEqual(profile, PARTNER_AGENT_PROFILE);
  assert.equal(profile.surface, 'partner');
  assert.equal(profile.id, 'kodax-space.partner');
  assert.match(profile.instructions, new RegExp(PARTNER_PROFILE_INSTRUCTIONS.slice(0, 32)));
  assert.match(profile.instructions, /knowledge-work surface/);
  assert.match(profile.instructions, /evidence-first/);
  assert.match(profile.instructions, /artifact/);
  assert.match(profile.instructions, /Partner KB tools/);
  assert.match(profile.instructions, /Do not edit project files/);
  assert.match(profile.instructions, /run shell commands/);
  assert.equal(profile.verification.rubricFamily, 'partner-research');
  assert.ok(profile.verification.requiredChecks?.includes('source-faithfulness'));
});

test('Partner prompt overlay only carries dynamic run context', () => {
  _clearPartnerSpaceToolPoliciesForTesting();
  const overlay = buildPartnerPromptOverlay();
  assert.match(overlay, /Partner run context/);
  assert.match(overlay, /none registered/);
  assert.match(overlay, /Selected Partner sources/);
  assert.doesNotMatch(overlay, /Partner surface profile/);
});

test('Partner tool policy summary exposes Space-owned tool scope and side effect', () => {
  const summary = buildPartnerToolPolicySummary([
    {
      name: 'partner_kb_write_page',
      scope: 'knowledge-base',
      sideEffect: 'mutates-state',
      description: 'Write a page inside the selected KB root.',
    },
  ]);
  assert.match(summary, /partner_kb_write_page/);
  assert.match(summary, /scope=knowledge-base/);
  assert.match(summary, /sideEffect=mutates-state/);
});

test('Partner prompt overlay includes registered Space Partner tools', () => {
  _clearPartnerSpaceToolPoliciesForTesting();
  registerPartnerSpaceToolPolicy({
    name: 'create_artifact',
    scope: 'artifact',
    sideEffect: 'mutates-state',
    description: 'Creates or updates Space artifacts.',
  });
  const overlay = buildPartnerPromptOverlay();
  assert.match(overlay, /create_artifact/);
  assert.match(overlay, /scope=artifact/);
  assert.match(overlay, /sideEffect=mutates-state/);
  _clearPartnerSpaceToolPoliciesForTesting();
});

test('Partner source summary exposes selected source ids and paths', () => {
  const summary = buildPartnerSourceSummary([
    {
      id: 'src_1',
      sessionId: 's1',
      kind: 'workspace_path',
      projectRoot: '/project',
      path: 'docs/spec.md',
      targetKind: 'file',
      label: 'spec.md',
      addedAt: 1,
    },
  ]);
  assert.match(summary, /src_1/);
  assert.match(summary, /docs\/spec\.md/);
  assert.match(summary, /projectRoot=\/project/);
});

test('Partner prompt overlay includes selected sources', () => {
  const overlay = buildPartnerPromptOverlay({
    sources: [
      {
        id: 'src_2',
        sessionId: 's1',
        kind: 'workspace_path',
        projectRoot: '/project',
        path: 'README.md',
        targetKind: 'file',
        label: 'README.md',
        addedAt: 1,
      },
    ],
  });
  assert.match(overlay, /src_2/);
  assert.match(overlay, /README\.md/);
});

test('SDK buildSystemPromptSnapshot includes Partner runtime context as prompt-overlay section', async () => {
  _clearPartnerSpaceToolPoliciesForTesting();
  const sdk = await import('@kodax-ai/kodax/coding');
  const overlay = buildPartnerPromptOverlay();
  const snapshot = await sdk.buildSystemPromptSnapshot(
    {
      provider: 'mock',
      context: {
        executionCwd: process.cwd(),
        gitRoot: process.cwd(),
        promptOverlay: overlay,
      },
    },
    false,
  );
  const section = snapshot.sections.find((s) => s.id === 'prompt-overlay');
  assert.ok(section, 'prompt-overlay section should be present');
  assert.equal(section?.content, overlay);
  assert.match(snapshot.rendered, /KodaX Space Partner run context/);
  assert.doesNotMatch(snapshot.rendered, /KodaX Space Partner surface profile/);
});
