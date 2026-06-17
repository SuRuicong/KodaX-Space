// workflow.* IPC handlers (F060).
//
// list/get：renderer 切 session 时播种已知 run，或按 runId 取单个 snapshot。
// 实时流走 push 通道 workflow.event（由 WorkflowController 订阅 SDK 后转发）。

import { registerChannel } from './register.js';
import { workflowController } from '../kodax/workflow-controller.js';

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
}
