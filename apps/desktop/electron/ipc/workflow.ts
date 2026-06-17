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
}
