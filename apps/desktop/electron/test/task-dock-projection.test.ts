import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskDockRunView } from '../../renderer/src/shell/taskDockProjection.js';

test('task dock run projection prioritizes blocking permission attention', () => {
  const view = buildTaskDockRunView({
    hasProject: true,
    hasSession: true,
    pendingSend: true,
    hasPermissionRequest: true,
  });

  assert.equal(view.mode, 'attention');
  assert.equal(view.attentionKind, 'permission');
  assert.equal(view.primaryTarget, 'run');
});

test('task dock run projection routes active worker to agents', () => {
  const view = buildTaskDockRunView({
    hasProject: true,
    hasSession: true,
    pendingSend: false,
    managedStatus: {
      agentMode: 'ama',
      harnessProfile: 'H2_PLAN_EXECUTE_EVAL',
      activeWorkerId: 'worker-1',
      activeWorkerTitle: 'Review worker',
      events: [
        {
          key: 'e1',
          kind: 'progress',
          workerId: 'worker-1',
          workerTitle: 'Review worker',
          summary: 'Reviewing changed files',
        },
      ],
    },
  });

  assert.equal(view.mode, 'running');
  assert.equal(view.primaryTarget, 'agents');
  assert.match(view.headline, /Review worker/);
});

test('task dock run projection gives no-project actionable state', () => {
  const view = buildTaskDockRunView({
    hasProject: false,
    hasSession: false,
    pendingSend: false,
  });

  assert.equal(view.mode, 'no_project');
  assert.equal(view.severity, 'neutral');
});

test('task dock run projection gives neutral idle state before a session exists', () => {
  const view = buildTaskDockRunView({
    hasProject: true,
    hasSession: false,
    pendingSend: false,
  });

  assert.equal(view.mode, 'idle');
  assert.equal(view.severity, 'neutral');
  assert.equal(view.headline, 'Ready');
});
