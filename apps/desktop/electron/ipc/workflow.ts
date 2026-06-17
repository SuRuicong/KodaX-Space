// workflow.* IPC handlers (F060).
//
// list/get：renderer 切 session 时播种已知 run，或按 runId 取单个 snapshot。
// 实时流走 push 通道 workflow.event（由 WorkflowController 订阅 SDK 后转发）。

import os from 'node:os';
import path from 'node:path';
import { registerChannel } from './register.js';
import { workflowController } from '../kodax/workflow-controller.js';
import { workflowPolicyStore } from '../kodax/workflow-policy.js';
import { kodaxHost } from '../kodax/host.js';

/**
 * SECURITY（F063）：saved 工作流是可执行 JS——loadSavedWorkflow/loadSavedWorkflowCapsule
 * 会加载并执行它。renderer 传来的 saved 路径必须限定在已知安全目录内，否则一个被攻陷的
 * renderer（XSS/恶意依赖）能让 main 进程加载任意 .js 以 Node 权限执行。
 * projectRoot 必须取自**可信的 main 侧 session**（不能信 renderer 传的，否则白名单可绕）。
 */
function isSafeWorkflowPath(filePath: string, projectRoot: string | undefined): boolean {
  const resolved = path.resolve(filePath);
  const allowed = [path.resolve(os.homedir(), '.kodax', 'workflows')];
  if (projectRoot) allowed.push(path.resolve(projectRoot, '.kodax', 'workflows'));
  return allowed.some((prefix) => resolved === prefix || resolved.startsWith(prefix + path.sep));
}

export function registerWorkflowChannels(): void {
  registerChannel('workflow.list', (input) => {
    const runs = workflowController.list(input?.sessionId);
    return { runs };
  });

  registerChannel('workflow.get', (input) => {
    const run = workflowController.get(input.runId);
    return { run };
  });

  // F062 run 生命周期控制。控制后状态变化由 workflow.event 自然回流，handler 只回 ok。
  registerChannel('workflow.stop', async (input) => ({
    ok: await workflowController.stop(input.runId, input.reason),
  }));

  registerChannel('workflow.pause', async (input) => ({
    ok: await workflowController.pause(input.runId),
  }));

  registerChannel('workflow.resume', async (input) => ({
    ok: await workflowController.resume(input.runId),
  }));

  registerChannel('workflow.rename', async (input) => ({
    ok: await workflowController.rename(input.runId, input.displayName),
  }));

  registerChannel('workflow.delete', async (input) => ({
    ok: await workflowController.deleteRun(input.runId, input.force),
  }));

  registerChannel('workflow.prune', async (input) => {
    const r = await workflowController.prune(input);
    // readonly candidates → mutable copy（schema 推断 string[]）。
    return {
      deleted: r.deleted,
      protectedRuns: r.protectedRuns,
      candidates: [...r.candidates],
      dryRun: r.dryRun,
    };
  });

  // F063 库 / preflight / 启动。
  registerChannel('workflow.library', async (input) => workflowController.listLibrary(input?.projectRoot));

  registerChannel('workflow.preflight', async (input) => {
    // 可信 projectRoot 取自 session；路径白名单（防任意文件加载执行）。
    const session = kodaxHost.get(input.sessionId);
    if (!isSafeWorkflowPath(input.path, session?.projectRoot)) {
      return { ok: false, issues: [{ severity: 'error', message: '路径不在允许的工作流目录内' }] };
    }
    return workflowController.preflightSaved(input.path);
  });

  registerChannel('workflow.start', async (input) => {
    // 从发起方 session 取运行时字段建 workflow 子 agent 的 KodaXOptions。
    const session = kodaxHost.get(input.sessionId);
    if (!session) return { error: 'session not found' };
    // SECURITY：saved 路径必须在白名单目录内（可信 projectRoot 来自 session）。
    if (input.source === 'saved' && !isSafeWorkflowPath(input.target, session.projectRoot)) {
      return { error: '路径不在允许的工作流目录内' };
    }
    const res = await workflowController.start({
      target: input.target,
      source: input.source,
      ...(input.args !== undefined ? { args: input.args } : {}),
      session: {
        sessionId: session.sessionId,
        surface: session.surface,
        provider: session.provider,
        ...(session.model !== undefined ? { model: session.model } : {}),
        reasoningMode: session.reasoningMode,
        agentMode: session.agentMode,
        projectRoot: session.projectRoot,
      },
    });
    return 'error' in res ? { error: res.error } : { runId: res.runId };
  });

  // F064 Host policy（AMAW 自启治理 + caps）。
  registerChannel('workflow.policy.get', () => workflowPolicyStore.get());
  registerChannel('workflow.policy.set', (input) => workflowPolicyStore.set(input));
}
