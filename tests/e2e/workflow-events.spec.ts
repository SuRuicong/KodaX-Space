import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { launchSpace, type SpaceInstance } from './fixtures.js';

type WorkflowStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
type WorkflowItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';

interface WorkflowItemForTest {
  id: string;
  title: string;
  kind: 'phase' | 'agent' | 'step' | 'artifact';
  status: WorkflowItemStatus;
  phaseId?: string;
  summaryStatus?: 'pending' | 'result' | 'notice' | 'unavailable';
  summary?: string;
}

interface WorkflowSnapshotForTest {
  runId: string;
  workflowName: string;
  displayName: string;
  status: WorkflowStatus;
  startedAt: string;
  updatedAt: string;
  elapsedMs?: number;
  patterns?: string[];
  activePhaseIndex?: number;
  phaseCount?: number;
  latestMessage?: string;
  resultSummary?: string;
  items: WorkflowItemForTest[];
  counts: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    skipped: number;
  };
  progress: {
    spawnedAgents: number;
    finishedAgents: number;
    activeAgents: number;
    failedAgents: number;
    stoppedAgents: number;
    plannedItems?: number;
  };
  tokens?: {
    spent: number;
    total?: number;
  };
}

interface WorkflowEventForTest {
  type: 'workflow_started' | 'workflow_updated' | 'workflow_finished';
  snapshot: WorkflowSnapshotForTest;
  message?: string;
  sessionId: string;
  surface: 'code';
  projectRoot?: string;
}

interface SessionListEnvelope {
  ok: boolean;
  data?: { sessions?: Array<{ sessionId: string }> };
}

async function launchSeededSpace(testId: string) {
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });
  const space = await launchSpace(testId);
  await space.seedProject(projectDir);
  return { space, projectDir };
}

function snapshot(over: Partial<WorkflowSnapshotForTest> = {}): WorkflowSnapshotForTest {
  const now = '2026-06-21T00:00:00.000Z';
  return {
    runId: 'wf-e2e',
    workflowName: 'generated',
    displayName: 'E2E Workflow Review',
    status: 'running',
    startedAt: now,
    updatedAt: now,
    patterns: ['fan-out-and-synthesize'],
    phaseCount: 2,
    items: [],
    counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
    progress: {
      spawnedAgents: 0,
      finishedAgents: 0,
      activeAgents: 0,
      failedAgents: 0,
      stoppedAgents: 0,
      plannedItems: 2,
    },
    ...over,
  };
}

async function getCurrentSessionId(space: SpaceInstance): Promise<string> {
  const readSessionId = () =>
    space.page.evaluate(async () => {
      const bridge = (
        window as unknown as {
          kodaxSpace: {
            invoke: (name: string, input: unknown) => Promise<SessionListEnvelope>;
          };
        }
      ).kodaxSpace;
      const result = await bridge.invoke('session.list', { surface: 'code' });
      if (!result.ok) return null;
      return result.data?.sessions?.[0]?.sessionId ?? null;
    });

  await expect.poll(readSessionId, { timeout: 8_000 }).not.toBeNull();
  const sessionId = await readSessionId();
  if (!sessionId) throw new Error('Session was not created');
  return sessionId;
}

async function emitWorkflowEvent(
  space: SpaceInstance,
  payload: WorkflowEventForTest,
): Promise<void> {
  await space.app.evaluate(({ BrowserWindow }, eventPayload) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('No BrowserWindow available');
    win.webContents.send('workflow.event', eventPayload);
  }, payload);
}

async function writePersistedWorkflowRun(
  space: SpaceInstance,
  projectDir: string,
): Promise<string> {
  const runId = 'wf_persisted_e2e';
  const runDir = path.join(space.testDataDir, 'space', 'workflow-runs', runId);
  const artifactsDir = path.join(runDir, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, 'manifest.json'),
    JSON.stringify({ patterns: ['fan-out-and-synthesize'] }),
  );
  await fs.writeFile(
    path.join(runDir, 'events.jsonl'),
    [
      { seq: 1, type: 'workflow_started', data: { runId }, ts: 1782039116701 },
      { seq: 2, type: 'phase_started', data: { name: 'Collect changes' }, ts: 1782039116703 },
      {
        seq: 3,
        type: 'agent_spawned',
        data: { taskId: 'wf-child-1', name: 'Change collector' },
        ts: 1782039116706,
      },
      {
        seq: 4,
        type: 'agent_completed',
        data: {
          taskId: 'wf-child-1',
          name: 'Change collector',
          status: 'completed',
          provider: 'mock-provider',
          summaryKind: 'pending',
          summary: 'Long raw child result should stay folded until a digest is available.',
        },
        ts: 1782039208729,
      },
      {
        seq: 5,
        type: 'agent_summary_updated',
        data: {
          taskId: 'wf-child-1',
          name: 'Change collector',
          summaryKind: 'digest',
          summary: 'Recovered persisted child digest.',
        },
        ts: 1782039226149,
      },
      { seq: 6, type: 'phase_finished', data: { name: 'Collect changes' }, ts: 1782039355793 },
      { seq: 7, type: 'phase_started', data: { name: 'Synthesize report' }, ts: 1782039355794 },
      { seq: 8, type: 'artifact_written', data: { name: 'final-report' }, ts: 1782039852802 },
      {
        seq: 9,
        type: 'workflow_completed',
        data: { resultSummary: '# Persisted final report\n\nRecovered from disk.' },
        ts: 1782039852803,
      },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n'),
  );
  await fs.writeFile(
    path.join(artifactsDir, 'final-report.json'),
    JSON.stringify({ report: '# Durable artifact report\n\nRecovered artifact body.' }),
  );
  await fs.writeFile(
    path.join(runDir, 'run.json'),
    JSON.stringify({
      runId,
      workflow: 'Persisted Workflow Review',
      displayName: 'Persisted Workflow Review',
      status: 'completed',
      startedAt: '2026-06-21T01:00:00.000Z',
      endedAt: '2026-06-21T01:01:00.000Z',
      totalSpawned: 1,
      args: { request: 'Restore completed workflow history' },
      artifacts: ['final-report'],
      resultSummary: '# Persisted final report\n\nRecovered from disk.',
      hostMetadata: {
        sessionId: 'persisted-session',
        surface: 'code',
        projectRoot: projectDir,
      },
    }),
  );
  return runId;
}

test('workflow push events update the sidebar and transcript through completion', async () => {
  const testId = `workflow-events-${Date.now()}`;
  const { space, projectDir } = await launchSeededSpace(testId);
  try {
    const textarea = space.page.locator('textarea').first();
    const stream = space.page.getByTestId('conversation-stream');
    await expect(textarea).toBeEnabled({ timeout: 10_000 });

    const prompt = 'seed workflow e2e session';
    await textarea.fill(prompt);
    await textarea.press('Enter');
    await expect(stream.getByTestId('user-message-bubble').filter({ hasText: prompt })).toBeVisible(
      {
        timeout: 5_000,
      },
    );

    const sessionId = await getCurrentSessionId(space);

    await emitWorkflowEvent(space, {
      type: 'workflow_started',
      sessionId,
      surface: 'code',
      message: 'agent spawned: Collector',
      snapshot: snapshot({
        activePhaseIndex: 0,
        latestMessage: 'agent spawned: Collector',
        items: [
          { id: 'p1', title: 'Collect changes', kind: 'phase', status: 'running' },
          { id: 'a1', title: 'Collector', kind: 'agent', phaseId: 'p1', status: 'running' },
          { id: 'p2', title: 'Review', kind: 'phase', status: 'pending' },
        ],
        counts: { pending: 1, running: 2, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
        progress: {
          spawnedAgents: 1,
          finishedAgents: 0,
          activeAgents: 1,
          failedAgents: 0,
          stoppedAgents: 0,
          plannedItems: 2,
        },
      }),
    });

    const sidebar = space.page.getByTestId('right-sidebar');
    await expect(sidebar).toContainText('E2E Workflow Review', { timeout: 5_000 });
    await expect(sidebar.getByLabel('Workflow flow graph')).toContainText('fan-out');
    await expect(sidebar.getByLabel('Workflow flow graph')).toContainText('Collect changes');
    await expect(space.page.getByTestId('workflow-live-strip')).toContainText(
      'E2E Workflow Review',
    );

    await emitWorkflowEvent(space, {
      type: 'workflow_updated',
      sessionId,
      surface: 'code',
      message: 'agent spawned: Reviewer',
      snapshot: snapshot({
        activePhaseIndex: 1,
        latestMessage: 'agent spawned: Reviewer',
        items: [
          { id: 'p1', title: 'Collect changes', kind: 'phase', status: 'completed' },
          {
            id: 'a1',
            title: 'Collector',
            kind: 'agent',
            phaseId: 'p1',
            status: 'completed',
            summaryStatus: 'result',
            summary: 'Collected changed files and commit history.',
          },
          { id: 'p2', title: 'Review', kind: 'phase', status: 'running' },
          { id: 'a2', title: 'Reviewer', kind: 'agent', phaseId: 'p2', status: 'running' },
        ],
        counts: { pending: 0, running: 2, completed: 2, failed: 0, cancelled: 0, skipped: 0 },
        progress: {
          spawnedAgents: 2,
          finishedAgents: 1,
          activeAgents: 1,
          failedAgents: 0,
          stoppedAgents: 0,
          plannedItems: 2,
        },
        tokens: { spent: 1200, total: 5000 },
      }),
    });

    await expect(
      stream.locator('[data-testid="system-notice"][data-notice-variant="workflow"]', {
        hasText: '[workflow] agent spawned: Reviewer',
      }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      stream.locator('[data-testid="system-notice"][data-notice-variant="workflow"]', {
        hasText: '[workflow] agent summary: Collector',
      }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      stream
        .getByTestId('user-message-bubble')
        .filter({ hasText: '[workflow] agent spawned: Reviewer' }),
    ).toHaveCount(0);

    await emitWorkflowEvent(space, {
      type: 'workflow_finished',
      sessionId,
      surface: 'code',
      message: 'workflow completed',
      snapshot: snapshot({
        status: 'completed',
        activePhaseIndex: 1,
        latestMessage: 'workflow completed',
        resultSummary: `# Final workflow report\n\n${'All checks passed with a detailed paragraph. '.repeat(
          30,
        )}\nTAIL_MARKER_VISIBLE_ONLY_WHEN_EXPANDED`,
        items: [
          { id: 'p1', title: 'Collect changes', kind: 'phase', status: 'completed' },
          {
            id: 'a1',
            title: 'Collector',
            kind: 'agent',
            phaseId: 'p1',
            status: 'completed',
            summaryStatus: 'result',
            summary: 'Collected changed files and commit history.',
          },
          { id: 'p2', title: 'Review', kind: 'phase', status: 'running' },
          { id: 'a2', title: 'Reviewer', kind: 'agent', phaseId: 'p2', status: 'running' },
        ],
        counts: { pending: 0, running: 2, completed: 2, failed: 0, cancelled: 0, skipped: 0 },
        progress: {
          spawnedAgents: 2,
          finishedAgents: 2,
          activeAgents: 0,
          failedAgents: 0,
          stoppedAgents: 0,
          plannedItems: 2,
        },
        tokens: { spent: 2400, total: 5000 },
      }),
    });

    await expect(space.page.getByTestId('workflow-live-strip')).toHaveCount(0);
    await expect(sidebar).toContainText('E2E Workflow Review');
    await expect(
      sidebar.getByLabel('Workflow flow graph').getByLabel('phase status: running'),
    ).toHaveCount(0);
    await expect(
      stream.locator('[data-testid="system-notice"][data-notice-variant="workflow"]', {
        hasText: '[workflow] completed: E2E Workflow Review',
      }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(stream).toContainText('# Final workflow report');
    await expect(sidebar).not.toContainText('TAIL_MARKER_VISIBLE_ONLY_WHEN_EXPANDED');
    await sidebar.getByTestId('workflow-summary-toggle').click();
    await expect(sidebar).toContainText('TAIL_MARKER_VISIBLE_ONLY_WHEN_EXPANDED');
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('workflow manager restores completed runs persisted on disk', async () => {
  const testId = `workflow-history-${Date.now()}`;
  const { space, projectDir } = await launchSeededSpace(testId);
  try {
    await writePersistedWorkflowRun(space, projectDir);

    await space.page.getByRole('button', { name: 'Open workflow panel' }).click();
    const panel = space.page.getByTestId('workflow-management-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await expect(panel).toContainText('Persisted Workflow Review', { timeout: 5_000 });
    await expect(panel).toContainText('completed');
    await expect(panel.getByLabel('Workflow flow graph')).toContainText('Collect changes');
    await expect(panel.getByLabel('Workflow flow graph')).toContainText('Synthesize report');
    await panel.getByRole('button', { name: 'Subagents' }).click();
    await expect(panel.getByTestId('workflow-management-detail')).toContainText('Change collector');
    await expect(panel.getByTestId('workflow-management-detail')).toContainText(
      'Recovered persisted child digest.',
    );
    await expect(panel.getByTestId('workflow-management-detail')).toContainText(
      'Recovered from disk.',
    );
    await panel.getByTestId('workflow-result-toggle').click();
    await expect(panel.getByTestId('workflow-management-detail')).toContainText(
      'Durable artifact report',
    );
    await expect(panel.getByTestId('workflow-management-detail')).not.toContainText('加载中');
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
