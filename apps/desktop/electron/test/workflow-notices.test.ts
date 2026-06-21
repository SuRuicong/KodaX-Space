import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowEventPayload, WorkflowRunT } from '@kodax-space/space-ipc-schema';
import {
  formatWorkflowActivityNotice,
  formatWorkflowEventNotices,
} from '../../renderer/src/features/workflow/workflowNotices.js';

function run(over: Partial<WorkflowRunT>): WorkflowRunT {
  return {
    runId: 'wf-notice',
    workflowName: 'review',
    status: 'running',
    startedAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:00:01.000Z',
    items: [],
    counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
    progress: {
      spawnedAgents: 0,
      finishedAgents: 0,
      activeAgents: 0,
      failedAgents: 0,
      stoppedAgents: 0,
    },
    ...over,
  };
}

function event(over: Partial<WorkflowEventPayload>): WorkflowEventPayload {
  return {
    type: 'workflow_updated',
    snapshot: run({}),
    sessionId: 's1',
    surface: 'code',
    ...over,
  };
}

test('workflow event notices include completed child agent summaries', () => {
  const notices = formatWorkflowEventNotices(
    event({
      snapshot: run({
        items: [
          {
            id: 'a1',
            title: 'Security review',
            kind: 'agent',
            status: 'completed',
            summaryStatus: 'result',
            summary: 'Checked IPC handlers.\nNo high risk issue found.',
          },
        ],
      }),
    }),
  );

  assert.equal(notices.length, 1);
  assert.match(notices[0]?.key ?? '', /^item:wf-notice:a1:/);
  assert.equal(
    notices[0]?.text,
    '[workflow] agent summary: Security review\nChecked IPC handlers.\nNo high risk issue found.',
  );
});

test('workflow finished notice preserves readable markdown instead of one-line collapse', () => {
  const notices = formatWorkflowEventNotices(
    event({
      type: 'workflow_finished',
      snapshot: run({
        status: 'completed',
        resultSummary: '# Final report\n\n- OK\n- Follow up later',
      }),
    }),
  );

  assert.equal(notices.length, 1);
  assert.match(notices[0]?.key ?? '', /^finished:wf-notice:completed:/);
  assert.equal(
    notices[0]?.text,
    '[workflow] completed: review\n# Final report\n\n- OK\n- Follow up later',
  );
});

test('workflow activity notices remain compact progress lines', () => {
  assert.equal(
    formatWorkflowActivityNotice({
      runId: 'wf-notice',
      childAgentName: 'Reviewer',
      kind: 'tool_use',
      toolName: 'grep',
    }),
    '[workflow] Reviewer: using grep',
  );
});
