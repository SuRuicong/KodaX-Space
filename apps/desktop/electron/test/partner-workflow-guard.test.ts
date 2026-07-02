// Partner /workflow boundary — only read-only inspection subcommands are
// reachable from a Partner session; execution-class + run-lifecycle kinds are
// fenced off (they would spawn full-tool-access child agents outside the Partner
// tool policy). See slash/builtin.ts `isPartnerAllowedWorkflowKind`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPartnerAllowedWorkflowKind } from '../slash/builtin.js';
import { workflowController } from '../kodax/workflow-controller.js';

test('Partner allows only read-only /workflow inspection kinds', () => {
  for (const kind of ['help', 'list', 'runs', 'show'] as const) {
    assert.equal(isPartnerAllowedWorkflowKind(kind), true, `expected ${kind} allowed in Partner`);
  }
});

test('Partner blocks every execution-class and run-lifecycle /workflow kind', () => {
  const blocked = [
    'pause',
    'resume',
    'stop',
    'delete',
    'prune',
    'save',
    'rename',
    'revise',
    'rerun',
    'create',
    'start',
  ] as const;
  for (const kind of blocked) {
    assert.equal(
      isPartnerAllowedWorkflowKind(kind),
      false,
      `expected ${kind} blocked in Partner`,
    );
  }
});

// The authoritative gate: WorkflowController rejects every workflow-launch path
// for a Partner session (defense-in-depth beyond the slash parser + IPC layer).
// assertCoderSurface runs before any SDK/runtime access, so no mocks are needed.
const partnerSession = {
  sessionId: 's-partner',
  surface: 'partner' as const,
  provider: 'anthropic',
  reasoningMode: 'auto',
  agentMode: 'ama',
  projectRoot: '/tmp/partner-guard',
};

test('WorkflowController.start rejects a Partner session', async () => {
  const res = await workflowController.start({ target: 'x', source: 'builtin', session: partnerSession });
  assert.ok('error' in res && res.error.includes('[partner]'), JSON.stringify(res));
});

test('WorkflowController.createGeneratedWorkflow rejects a Partner session', async () => {
  const res = await workflowController.createGeneratedWorkflow('build me a thing', partnerSession);
  assert.ok('error' in res && res.error.includes('[partner]'), JSON.stringify(res));
});

test('WorkflowController.rerunGeneratedWorkflow rejects a Partner session', async () => {
  const res = await workflowController.rerunGeneratedWorkflow('wf_x', {}, partnerSession);
  assert.ok('error' in res && res.error.includes('[partner]'), JSON.stringify(res));
});
