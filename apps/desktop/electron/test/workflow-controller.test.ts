// F060 — WorkflowController: 进程事件转发 + host 归属 + list/get + 归属持久化 + schema round-trip.
// 用 fake run manager（不碰真 SDK / LLM），real tmp-dir 持久化（DI），无 mock 文件系统。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowController, _setCodingSdkForTesting } from '../kodax/workflow-controller.js';
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

test('hostMetadata attributes events + list + get without local origin registration', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: Array<{ sessionId?: string; surface?: string; snapshot: { runId: string } }> = [];
    const ctrl = new WorkflowController((p) => pushed.push(p as never), file);
    const mgr = fakeManager();
    await ctrl.init(mgr);

    mgr._emit({
      type: 'workflow_updated',
      snapshot: sampleSnapshot('r_meta', {
        hostMetadata: { sessionId: 's_meta', surface: 'partner' },
      }),
      message: 'phase 2',
    });

    assert.equal(pushed.length, 1);
    assert.equal(pushed[0]?.sessionId, 's_meta');
    assert.equal(pushed[0]?.surface, 'partner');
    assert.equal(ctrl.get('r_meta')?.sessionId, 's_meta');
    assert.equal(ctrl.list('s_meta')[0]?.runId, 'r_meta');
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

test('stop pushes an immediate cancelled snapshot fallback', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: unknown[] = [];
    const ctrl = new WorkflowController((p) => pushed.push(p), file);
    const lc = fakeLifecycle();
    const mgr = fakeManager();
    await ctrl.init(mgr, lc);
    ctrl.registerOrigin('r1', { sessionId: 's1', surface: 'code' });
    await ctrl.flush();
    mgr._seed(
      sampleSnapshot('r1', {
        items: [
          { id: 'p1', title: 'Find', kind: 'phase', status: 'running' },
          { id: 'a1', title: 'finder:bugs', kind: 'agent', status: 'pending', phaseId: 'p1' },
        ],
        counts: { pending: 1, running: 1, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
        progress: { spawnedAgents: 1, finishedAgents: 0, activeAgents: 1, failedAgents: 0, stoppedAgents: 0 },
      }),
    );

    assert.equal(await ctrl.stop('r1', 'user stop'), true);
    assert.equal(pushed.length, 1);
    const parsed = workflowEventChannel.payload.safeParse(pushed[0]);
    assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
    if (parsed.success) {
      assert.equal(parsed.data.type, 'workflow_finished');
      assert.equal(parsed.data.sessionId, 's1');
      assert.equal(parsed.data.snapshot.status, 'cancelled');
      assert.deepEqual(parsed.data.snapshot.items.map((item) => item.status), ['cancelled', 'skipped']);
      assert.equal(parsed.data.snapshot.counts.cancelled, 1);
      assert.equal(parsed.data.snapshot.counts.skipped, 1);
      assert.equal(parsed.data.snapshot.progress.activeAgents, 0);
      assert.equal(parsed.data.snapshot.progress.stoppedAgents, 1);
      assert.equal(parsed.data.snapshot.latestMessage, 'user stop');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stop returns after local fallback when lifecycle stop hangs', async () => {
  const { dir, file } = freshFile();
  try {
    const pushed: unknown[] = [];
    const ctrl = new WorkflowController((p) => pushed.push(p), file);
    const lc = fakeLifecycle();
    lc.stopWorkflow = async (runId, reason) => {
      lc.calls.push(['stop', [runId, reason]]);
      return new Promise<boolean>(() => {});
    };
    const mgr = fakeManager();
    await ctrl.init(mgr, lc);
    mgr._seed(sampleSnapshot('r1'));

    const result = await Promise.race([
      ctrl.stop('r1', 'user stop'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100)),
    ]);
    assert.equal(result, true);
    assert.equal(pushed.length, 1);
    assert.deepEqual(lc.calls.at(-1), ['stop', ['r1', 'user stop']]);
    const parsed = workflowEventChannel.payload.safeParse(pushed[0]);
    assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
    if (parsed.success) {
      assert.equal(parsed.data.type, 'workflow_finished');
      assert.equal(parsed.data.snapshot.status, 'cancelled');
    }
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

function generatedWorkflow(name = 'generated-workflow') {
  const manifest = { name, description: 'Generated workflow', patterns: ['investigate'] };
  const source = 'export default {}';
  return {
    kind: 'generated' as const,
    manifest,
    source,
    module: { meta: { name } },
    scriptSnapshot: { manifest, source },
  };
}

function generatedCapsule(name = 'generated-workflow') {
  const manifest = { name, description: 'Generated workflow', patterns: ['investigate'] };
  return { manifest, source: 'export default {}' };
}

test('generated workflow controller methods delegate to SDK and start/save successfully', async () => {
  const { dir, file } = freshFile();
  try {
    const calls: string[] = [];
    const sdk = {
      async generateWorkflowFromOptions() {
        calls.push('generate');
        return generatedWorkflow('new-flow');
      },
      async loadGeneratedWorkflowFromRun() {
        calls.push('load-run');
        return { capsule: generatedCapsule('old-flow'), module: { meta: { name: 'old-flow' } } };
      },
      async preflightWorkflowCapsule() {
        calls.push('preflight');
        return { ok: true, issues: [] };
      },
      async saveGeneratedWorkflowFromRun(input: { name: string }) {
        calls.push(`save-run:${input.name}`);
        return { name: input.name, path: '/tmp/saved.workflow.ts' };
      },
      async renameSavedWorkflow(input: { newName: string }) {
        calls.push(`rename-saved:${input.newName}`);
        return { name: input.newName, path: '/tmp/renamed.workflow.ts' };
      },
      async deleteSavedWorkflow(input: { name: string }) {
        calls.push(`delete-saved:${input.name}`);
        return { name: input.name, path: '/tmp/deleted.workflow.ts' };
      },
    };
    _setCodingSdkForTesting(sdk);

    const ctrl = new WorkflowController(() => {}, file);
    const mgr = fakeManager();
    await ctrl.init(mgr);

    const created = await ctrl.createGeneratedWorkflow('make a workflow', LAUNCH_SESSION);
    assert.ok('runId' in created, JSON.stringify(created));
    assert.equal(mgr.started.length, 1);
    assert.equal((mgr.started[0]!.processMetadata as { source?: string }).source, 'command');

    const rerun = await ctrl.rerunGeneratedWorkflow('run_1', { foo: true }, LAUNCH_SESSION);
    assert.ok('runId' in rerun, JSON.stringify(rerun));
    assert.equal(mgr.started.length, 2);

    assert.deepEqual(await ctrl.saveGeneratedWorkflowFromRun('run_1', 'saved-name', process.cwd()), {
      name: 'saved-name',
      path: '/tmp/saved.workflow.ts',
    });
    assert.deepEqual(await ctrl.renameSavedWorkflow('saved-name', 'renamed', process.cwd()), {
      name: 'renamed',
      path: '/tmp/renamed.workflow.ts',
    });
    assert.deepEqual(await ctrl.deleteSavedWorkflow('renamed', process.cwd()), {
      name: 'renamed',
      path: '/tmp/deleted.workflow.ts',
    });
    assert.deepEqual(calls, [
      'generate',
      'load-run',
      'preflight',
      'save-run:saved-name',
      'rename-saved:renamed',
      'delete-saved:renamed',
    ]);
  } finally {
    _setCodingSdkForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reviseWorkflow handles discovery failure inside error contract', async () => {
  const { dir, file } = freshFile();
  try {
    const savedNames: string[] = [];
    _setCodingSdkForTesting({
      async loadGeneratedWorkflowFromRun() {
        return { capsule: generatedCapsule('base-flow'), module: {} };
      },
      async generateWorkflowFromOptions() {
        return generatedWorkflow('base-flow');
      },
      async discoverSavedWorkflows() {
        throw new Error('disk unavailable');
      },
      async saveGeneratedWorkflow(input: { name: string }) {
        savedNames.push(input.name);
        return { name: input.name, path: '/tmp/revision.workflow.ts' };
      },
    });

    const ctrl = new WorkflowController(() => {}, file);
    await ctrl.init(fakeManager());
    const result = await ctrl.reviseWorkflow({
      target: 'run_1',
      request: 'tighten validation',
      session: LAUNCH_SESSION,
    });

    assert.ok(!('error' in result), JSON.stringify(result));
    assert.match(result.name, /^base-flow-revision-/);
    assert.deepEqual(savedNames, [result.name]);
  } finally {
    _setCodingSdkForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reviseWorkflow validates replace target before loading run artifacts', async () => {
  const { dir, file } = freshFile();
  try {
    let loaded = false;
    _setCodingSdkForTesting({
      async loadGeneratedWorkflowFromRun() {
        loaded = true;
        return { capsule: generatedCapsule(), module: {} };
      },
      async generateWorkflowFromOptions() {
        return generatedWorkflow();
      },
    });

    const ctrl = new WorkflowController(() => {}, file);
    await ctrl.init(fakeManager());
    const result = await ctrl.reviseWorkflow({
      target: 'run_1',
      request: 'change it',
      replace: true,
      session: LAUNCH_SESSION,
    });

    assert.deepEqual(result, { error: 'revise --replace requires a saved workflow name target' });
    assert.equal(loaded, false);
  } finally {
    _setCodingSdkForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rerunGeneratedWorkflow logs direct preflight fallback before boxed retry', async () => {
  const { dir, file } = freshFile();
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  try {
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    let preflightCalls = 0;
    _setCodingSdkForTesting({
      async loadGeneratedWorkflowFromRun() {
        return { capsule: generatedCapsule('preflight-flow'), module: { meta: { name: 'preflight-flow' } } };
      },
      async preflightWorkflowCapsule(input: unknown) {
        preflightCalls += 1;
        if (!('capsule' in (input as Record<string, unknown>))) throw new Error('old signature');
        return { ok: true, issues: [] };
      },
    });

    const ctrl = new WorkflowController(() => {}, file);
    await ctrl.init(fakeManager());
    const result = await ctrl.rerunGeneratedWorkflow('run_1', {}, LAUNCH_SESSION);

    assert.ok('runId' in result, JSON.stringify(result));
    assert.equal(preflightCalls, 2);
    assert.ok(
      warnings.some((args) => String(args[0]).includes('preflightWorkflowCapsule direct call failed')),
      JSON.stringify(warnings),
    );
  } finally {
    console.warn = originalWarn;
    _setCodingSdkForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

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
      const metadata = call.processMetadata as { hostMetadata?: Record<string, string> };
      assert.equal(metadata.hostMetadata?.sessionId, 's1');
      assert.equal(metadata.hostMetadata?.surface, 'code');
      assert.equal(metadata.hostMetadata?.host, 'kodax-space');
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
    assert.ok(Array.isArray(lib.patterns));
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
      hostMetadata: { sessionId: 's1', surface: 'code' },
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
    assert.equal(snapParsed.success && snapParsed.data.hostMetadata?.sessionId, 's1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
