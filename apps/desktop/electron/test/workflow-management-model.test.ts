import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowRunT } from '@kodax-space/space-ipc-schema';
import {
  chooseWorkflowManagementSelection,
  relatedRunsForSavedWorkflow,
  savedWorkflowKey,
  sortWorkflowRunsForManagement,
  workflowRunBelongsToProject,
} from '../../renderer/src/features/workflow/workflowManagementModel.js';

function run(over: Partial<WorkflowRunT> & { runId: string }): WorkflowRunT {
  const { runId, ...rest } = over;
  return {
    runId,
    workflowName: 'review',
    status: 'completed',
    startedAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:00:00.000Z',
    items: [],
    counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
    progress: {
      spawnedAgents: 0,
      finishedAgents: 0,
      activeAgents: 0,
      failedAgents: 0,
      stoppedAgents: 0,
    },
    ...rest,
  };
}

test('workflow management selection prefers current-session active run', () => {
  const runs = sortWorkflowRunsForManagement([
    run({
      runId: 'wf-old',
      status: 'running',
      sessionId: 's-other',
      updatedAt: '2026-06-21T00:00:05.000Z',
    }),
    run({
      runId: 'wf-current',
      status: 'running',
      sessionId: 's-current',
      updatedAt: '2026-06-21T00:00:01.000Z',
    }),
  ]);

  assert.deepEqual(
    chooseWorkflowManagementSelection({
      current: null,
      runs,
      saved: [],
      currentSessionId: 's-current',
    }),
    { kind: 'run', id: 'wf-current' },
  );
});

test('workflow management keeps saved selection while still valid', () => {
  const saved = {
    name: 'version-review',
    path: 'C:/repo/.kodax/workflows/version-review.workflow.js',
    source: 'project',
  };

  assert.deepEqual(
    chooseWorkflowManagementSelection({
      current: { kind: 'saved', key: savedWorkflowKey(saved) },
      runs: [],
      saved: [saved],
      currentSessionId: null,
    }),
    { kind: 'saved', key: 'project:C:/repo/.kodax/workflows/version-review.workflow.js' },
  );
});

test('workflow management matches saved workflow to historical runs', () => {
  const saved = {
    name: 'version-review',
    path: 'C:/repo/.kodax/workflows/version-review.workflow.js',
    source: 'project',
  };
  const runs = [
    run({ runId: 'wf-1', workflowName: 'version-review' }),
    run({ runId: 'wf-2', displayName: 'other-review' }),
    run({ runId: 'wf-3', savedWorkflowName: 'version-review' }),
  ];

  assert.deepEqual(
    relatedRunsForSavedWorkflow(saved, runs).map((item) => item.runId),
    ['wf-1', 'wf-3'],
  );
});

test('workflow management includes persisted project runs without a known session', () => {
  const projectSessionIds = new Set<string>();
  assert.equal(
    workflowRunBelongsToProject({
      run: run({
        runId: 'wf-project',
        surface: 'code',
        projectRoot: 'C:\\Works\\Repo',
      }),
      currentProjectPath: 'c:/works/repo/',
      currentSessionId: 's-current',
      currentSurface: 'code',
      projectSessionIds,
    }),
    true,
  );
});

test('workflow management rejects persisted project runs from another surface', () => {
  assert.equal(
    workflowRunBelongsToProject({
      run: run({
        runId: 'wf-partner',
        surface: 'partner',
        hostMetadata: { projectRoot: 'C:\\Works\\Repo' },
      }),
      currentProjectPath: 'C:\\Works\\Repo',
      currentSessionId: null,
      currentSurface: 'code',
      projectSessionIds: new Set(),
    }),
    false,
  );
});
