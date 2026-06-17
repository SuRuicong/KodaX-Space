// F060 — WorkflowController: 进程事件转发 + host 归属 + list/get + 归属持久化 + schema round-trip.
// 用 fake run manager（不碰真 SDK / LLM），real tmp-dir 持久化（DI），无 mock 文件系统。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowController } from '../kodax/workflow-controller.js';
import type {
  WorkflowRunManagerLike,
  WorkflowLifecycleLike,
} from '../kodax/workflow-controller.js';
import { workflowEventChannel, workflowProcessSnapshotSchema } from '@kodax-space/space-ipc-schema';

// ---- fake run manager（可手动 emit 进程事件 + 持有 snapshot）----
interface FakeSnap {
  runId: string;
  [k: string]: unknown;
}
type FakeEvent = { type: 'workflow_started' | 'workflow_updated' | 'workflow_finished'; snapshot: FakeSnap; message?: string };

function fakeManager() {
  let listener: ((e: FakeEvent) => void) | null = null;
  const snaps = new Map<string, FakeSnap>();
  const started: Record<string, unknown>[] = [];
  const mgr: WorkflowRunManagerLike & {
    started: typeof started;
    _emit(e: FakeEvent): void;
    _seed(s: FakeSnap): void;
  } = {
    started,
    subscribeWorkflowProcess(l) {
      listener = l as (e: FakeEvent) => void;
      return () => {
        listener = null;
      };
    },
    getWorkflowProcessSnapshot(id) {
      return snaps.get(id) as never;
    },
    listWorkflowProcessSnapshots() {
      return [...snaps.values()] as never;
    },
    startFromOptions(input) {
      started.push(input);
      return { runId: (input as { runId?: string }).runId };
    },
    _emit(e) {
      snaps.set(e.snapshot.runId, e.snapshot);
      listener?.(e);
    },
    _seed(s) {
      snaps.set(s.runId, s);
    },
  };
  return mgr;
}

// 一个通过 schema 校验的最小有效 snapshot。
function sampleSnapshot(runId: string, over: Record<string, unknown> = {}): FakeSnap {
  return {
    runId,
    workflowName: 'parallel-investigation',
    status: 'running',
    startedAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:01.000Z',
    items: [
      { id: 'p1', title: 'Find', kind: 'phase', status: 'running' },
      { id: 'a1', title: 'finder:bugs', kind: 'agent', status: 'completed', phaseId: 'p1' },
    ],
    counts: { pending: 0, running: 1, completed: 1, failed: 0, cancelled: 0, skipped: 0 },
    progress: { spawnedAgents: 1, finishedAgents: 1, activeAgents: 0, failedAgents: 0, stoppedAgents: 0 },
    ...over,
  };
}

function freshFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wf-ctrl-'));
  return { dir, file: join(dir, 'workflow-origins.json') };
}

test('subscribe forwards process events to renderer (no attribution when origin unknown)', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: unknown[] = [];
    const ctrl = new WorkflowController((p) => pushed.push(p), file);
    const mgr = fakeManager();
    await ctrl.init(mgr);

    mgr._emit({ type: 'workflow_started', snapshot: sampleSnapshot('r1') });
    assert.equal(pushed.length, 1);
    const p0 = pushed[0] as { type: string; snapshot: { runId: string }; sessionId?: string };
    assert.equal(p0.type, 'workflow_started');
    assert.equal(p0.snapshot.runId, 'r1');
    assert.equal(p0.sessionId, undefined); // 未登记归属
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registerOrigin attributes subsequent events + list + get', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: Array<{ sessionId?: string; surface?: string; snapshot: { runId: string } }> = [];
    const ctrl = new WorkflowController((p) => pushed.push(p as never), file);
    const mgr = fakeManager();
    await ctrl.init(mgr);

    ctrl.registerOrigin('r1', { sessionId: 's_abc', surface: 'code' });
    mgr._emit({ type: 'workflow_updated', snapshot: sampleSnapshot('r1'), message: 'phase 2' });

    assert.equal(pushed.length, 1);
    assert.equal(pushed[0]?.sessionId, 's_abc');
    assert.equal(pushed[0]?.surface, 'code');

    // list + get 也带归属
    const list = ctrl.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.sessionId, 's_abc');
    const got = ctrl.get('r1');
    assert.equal(got?.sessionId, 's_abc');
    assert.equal(ctrl.get('nope'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list filters by sessionId; external (unattributed) run excluded from a session filter', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const mgr = fakeManager();
    await ctrl.init(mgr);
    mgr._seed(sampleSnapshot('r1'));
    mgr._seed(sampleSnapshot('r2'));
    ctrl.registerOrigin('r1', { sessionId: 's1', surface: 'code' });
    // r2 无归属（模拟 REPL/CLI 外部发起）

    assert.equal(ctrl.list().length, 2); // 不过滤 = 全部
    const forS1 = ctrl.list('s1');
    assert.equal(forS1.length, 1);
    assert.equal(forS1[0]?.runId, 'r1');
    assert.equal(ctrl.list('other').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('origins persist across controller instances (interim attribution survives restart)', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl1 = new WorkflowController(() => {}, file);
    await ctrl1.init(fakeManager());
    ctrl1.registerOrigin('r1', { sessionId: 's_persist', surface: 'partner' });
    await ctrl1.flush();
    assert.ok(existsSync(file), 'origins file written');

    // 新实例（模拟重启），同文件 + 重新 seed snapshot
    const ctrl2 = new WorkflowController(() => {}, file);
    const mgr2 = fakeManager();
    await ctrl2.init(mgr2);
    mgr2._seed(sampleSnapshot('r1'));

    const got = ctrl2.get('r1');
    assert.equal(got?.sessionId, 's_persist');
    assert.equal(got?.surface, 'partner');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- F062 控制方法 ----
function fakeLifecycle() {
  const calls: Array<[string, unknown[]]> = [];
  const lc: WorkflowLifecycleLike & { calls: typeof calls } = {
    calls,
    async stopWorkflow(runId, reason) {
      calls.push(['stop', [runId, reason]]);
      return true;
    },
    async pauseWorkflow(runId) {
      calls.push(['pause', [runId]]);
      return true;
    },
    async resumeWorkflow(runId) {
      calls.push(['resume', [runId]]);
      return true;
    },
    async renameWorkflowRun(runId, name) {
      calls.push(['rename', [runId, name]]);
      return true;
    },
    async deleteWorkflowRun(runId, opts) {
      calls.push(['delete', [runId, opts]]);
      return true;
    },
    async pruneWorkflowRuns(opts) {
      calls.push(['prune', [opts]]);
      return { deleted: 2, protectedRuns: 1, candidates: ['r1', 'r2'], dryRun: opts.dryRun ?? false };
    },
    async readWorkflowResult(runId) {
      calls.push(['readResult', [runId]]);
      return `result for ${runId}`;
    },
    async readWorkflowArtifact(runId, name) {
      calls.push(['readArtifact', [runId, name]]);
      return `# ${name}\nartifact body`;
    },
  };
  return lc;
}

test('stop/pause/resume/rename delegate to lifecycle controller', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const lc = fakeLifecycle();
    await ctrl.init(fakeManager(), lc);
    assert.equal(await ctrl.stop('r1', 'because'), true);
    assert.equal(await ctrl.pause('r1'), true);
    assert.equal(await ctrl.resume('r1'), true);
    assert.equal(await ctrl.rename('r1', 'New Name'), true);
    assert.deepEqual(lc.calls, [
      ['stop', ['r1', 'because']],
      ['pause', ['r1']],
      ['resume', ['r1']],
      ['rename', ['r1', 'New Name']],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleteRun drops local origin on success; prune returns lifecycle result', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const lc = fakeLifecycle();
    const mgr = fakeManager();
    await ctrl.init(mgr, lc);
    ctrl.registerOrigin('r1', { sessionId: 's1', surface: 'code' });
    mgr._seed(sampleSnapshot('r1'));
    await ctrl.flush();

    assert.equal(await ctrl.deleteRun('r1', true), true);
    assert.deepEqual(lc.calls.at(-1), ['delete', ['r1', { force: true }]]);
    // 归属被清（get 不再带 sessionId — 虽 snapshot 还在 fake manager 里）
    assert.equal(ctrl.get('r1')?.sessionId, undefined);

    const res = await ctrl.prune({ keep: 5, dryRun: true });
    assert.equal(res.deleted, 2);
    assert.equal(res.dryRun, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('control methods degrade safely when no lifecycle injected (fake manager path)', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    // 只注入 manager，不注入 lifecycle → 不自动建真 SDK lifecycle（managerInjected=true）。
    await ctrl.init(fakeManager());
    assert.equal(await ctrl.stop('r1'), false);
    assert.equal(await ctrl.pause('r1'), false);
    assert.equal(await ctrl.rename('r1', 'x'), false);
    assert.equal(await ctrl.deleteRun('r1'), false);
    const res = await ctrl.prune({ keep: 1 });
    assert.deepEqual(res, { deleted: 0, protectedRuns: 0, candidates: [], dryRun: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- F063 库 / 启动（用真 SDK 解析 module，但 startFromOptions 是 fake → 不跑、不花 token）----
const LAUNCH_SESSION = {
  sessionId: 's1',
  surface: 'code' as const,
  provider: 'mock',
  reasoningMode: 'auto',
  agentMode: 'ama',
  projectRoot: process.cwd(),
};

test('start: builtin workflow resolves via real SDK + startFromOptions + origin registered', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const mgr = fakeManager();
    await ctrl.init(mgr); // fake manager, no lifecycle
    const res = await ctrl.start({
      target: 'parallel-investigation',
      source: 'builtin',
      session: LAUNCH_SESSION,
    });
    assert.ok('runId' in res, JSON.stringify(res));
    if ('runId' in res) {
      assert.ok(res.runId.startsWith('wf_'));
      assert.equal(mgr.started.length, 1);
      const call = mgr.started[0]!;
      assert.equal(call.runId, res.runId);
      assert.equal((call.options as { provider?: string }).provider, 'mock');
      assert.ok(call.module, 'real module passed');
      // 归属已登记
      mgr._seed(sampleSnapshot(res.runId));
      assert.equal(ctrl.get(res.runId)?.sessionId, 's1');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start: unknown builtin returns error (no run started)', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    const mgr = fakeManager();
    await ctrl.init(mgr);
    const res = await ctrl.start({ target: 'no-such-workflow', source: 'builtin', session: LAUNCH_SESSION });
    assert.ok('error' in res);
    assert.equal(mgr.started.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listLibrary: real SDK returns parallel-investigation among built-ins', async () => {
  const { dir, file } = freshFile();
  try {
    const ctrl = new WorkflowController(() => {}, file);
    await ctrl.init(fakeManager());
    const lib = await ctrl.listLibrary(process.cwd());
    assert.ok(lib.builtin.some((w) => w.name === 'parallel-investigation'), JSON.stringify(lib.builtin));
    assert.ok(Array.isArray(lib.saved));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('forwarded payload + snapshot pass the IPC zod schema (no drift / field loss)', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: unknown[] = [];
    const ctrl = new WorkflowController((p) => pushed.push(p), file);
    const mgr = fakeManager();
    await ctrl.init(mgr);
    ctrl.registerOrigin('r1', { sessionId: 's1', surface: 'code' });

    const snap = sampleSnapshot('r1', {
      displayName: 'PR security review',
      source: 'amaw',
      tokens: { spent: 1234, total: 200000 },
      latestMessage: 'verifying findings',
      artifacts: [{ name: 'report', description: 'final' }],
    });
    mgr._emit({ type: 'workflow_finished', snapshot: { ...snap, status: 'completed' }, message: 'done' });

    // push payload 必须过 push 通道 schema
    const parsed = workflowEventChannel.payload.safeParse(pushed[0]);
    assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
    // snapshot 子结构也独立过 snapshot schema（不丢字段）
    const snapParsed = workflowProcessSnapshotSchema.safeParse(
      (pushed[0] as { snapshot: unknown }).snapshot,
    );
    assert.ok(snapParsed.success);
    assert.equal(snapParsed.success && snapParsed.data.tokens?.spent, 1234);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
