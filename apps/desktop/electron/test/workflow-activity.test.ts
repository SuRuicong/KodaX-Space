// F065 — 子 agent 活动路由纯逻辑：correlation 检测 + payload 构造。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childRunId, buildChildActivity } from '../kodax/workflow-activity.js';

test('childRunId: 带 workflowRunId 的 meta 识别为子事件；否则 undefined', () => {
  assert.equal(childRunId({ workflowCorrelation: { workflowRunId: 'wf_1' } }), 'wf_1');
  assert.equal(childRunId({ workflowCorrelation: {} }), undefined);
  assert.equal(childRunId({}), undefined);
  assert.equal(childRunId(undefined), undefined);
  assert.equal(childRunId({ workflowCorrelation: { workflowRunId: '' } }), undefined); // 空串不算
});

test('buildChildActivity: 子事件构造完整 payload（含 childAgentId/Name/toolName）', () => {
  const p = buildChildActivity(
    {
      workflowCorrelation: { workflowRunId: 'wf_1', childAgentId: 'c1' },
      childAgentName: 'finder:bugs',
    },
    'tool_use',
    { toolName: 'grep' },
  );
  assert.deepEqual(p, {
    runId: 'wf_1',
    childAgentId: 'c1',
    childAgentName: 'finder:bugs',
    kind: 'tool_use',
    toolName: 'grep',
  });
});

test('buildChildActivity: 非子事件返回 null（main agent 事件不路由）', () => {
  assert.equal(buildChildActivity({}, 'tool_use', { toolName: 'grep' }), null);
  assert.equal(buildChildActivity(undefined, 'end', {}), null);
});

test('buildChildActivity: childAgentId 回退到 correlation.childAgentId；end 无 toolName', () => {
  const p = buildChildActivity({ workflowCorrelation: { workflowRunId: 'wf_2', childAgentId: 'c9' } }, 'end', {});
  assert.equal(p?.runId, 'wf_2');
  assert.equal(p?.childAgentId, 'c9');
  assert.equal(p?.kind, 'end');
  assert.equal(p?.toolName, undefined);
});
