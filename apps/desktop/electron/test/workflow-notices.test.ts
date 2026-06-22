import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowEventPayload, WorkflowRunT } from '@kodax-space/space-ipc-schema';
import {
  formatWorkflowActivityNotice,
  formatWorkflowEventNotices,
  formatWorkflowRunRestoreNotices,
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

test('workflow finished notice keeps full final report text', () => {
  const repeated = 'All checks passed with detailed evidence.\n'.repeat(80);
  const tail = 'TAIL_MARKER_VISIBLE_AFTER_LONG_REPORT';
  const notices = formatWorkflowEventNotices(
    event({
      type: 'workflow_finished',
      snapshot: run({
        status: 'completed',
        resultSummary: `# Final report\n\n${repeated}${tail}`,
      }),
    }),
  );

  assert.equal(notices.length, 1);
  assert.ok(notices[0]?.text.includes(tail));
  assert.ok(!notices[0]?.text.endsWith('\n...'));
});

test('restored workflow runs hydrate child summaries and final report notices', () => {
  const notices = formatWorkflowRunRestoreNotices(
    run({
      status: 'completed',
      updatedAt: '2026-06-21T00:02:00.000Z',
      sessionId: 's1',
      surface: 'code',
      items: [
        {
          id: 'a1',
          title: 'Impact reviewer',
          kind: 'agent',
          status: 'completed',
          summaryStatus: 'result',
          summary: 'Recovered child digest.',
          endedAt: '2026-06-21T00:01:00.000Z',
        },
      ],
      resultSummary: '# Restored final report\n\nWorkflow completed.',
    }),
  );

  assert.equal(notices.length, 2);
  assert.match(notices[0]?.key ?? '', /^item:wf-notice:a1:/);
  assert.equal(
    notices[0]?.text,
    '[workflow] agent summary: Impact reviewer\nRecovered child digest.',
  );
  assert.equal(notices[0]?.sentAt, Date.parse('2026-06-21T00:01:00.000Z'));
  assert.match(notices[1]?.key ?? '', /^finished:wf-notice:completed:/);
  assert.equal(
    notices[1]?.text,
    '[workflow] completed: review\n# Restored final report\n\nWorkflow completed.',
  );
  assert.equal(notices[1]?.sentAt, Date.parse('2026-06-21T00:02:00.000Z'));
});

test('workflow event notices surface meaningful progress messages', () => {
  const notices = formatWorkflowEventNotices(
    event({
      message: 'agent spawned: Collect changes',
    }),
  );

  assert.equal(notices.length, 1);
  assert.match(notices[0]?.key ?? '', /^progress:wf-notice:/);
  assert.equal(notices[0]?.text, '[workflow] agent spawned: Collect changes');
});

test('workflow event notices ignore generic live refresh messages', () => {
  const notices = formatWorkflowEventNotices(
    event({
      message: 'running',
    }),
  );

  assert.equal(notices.length, 0);
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
