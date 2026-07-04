// parseTaskCompletedNotice — 识别 SDK 存进 transcript 的 `<task-completed>` 结果块并格式化。
// 这是 workflow resume 位置修复(approach A)的核心识别逻辑。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTaskCompletedNotice,
  TASK_COMPLETED_BODY_MAX,
} from '../ipc/workflow-result-notice.js';

test('completed report: labeled + run-id tagged + wrapper tags stripped', () => {
  const out = parseTaskCompletedNotice(
    '<task-completed task_id="run-abc">\n# Review 报告\nbody line</task-completed>',
  );
  assert.ok(out !== undefined);
  assert.match(out, /^\[workflow\] completed · run-abc/);
  assert.match(out, /# Review 报告/);
  assert.match(out, /body line/);
  assert.doesNotMatch(out, /<task-completed/);
  assert.doesNotMatch(out, /<\/task-completed>/);
});

test('failure block → failed label', () => {
  const out = parseTaskCompletedNotice(
    '<task-completed task_id="run-x"> [Tool Error] Workflow run-x failed: boom',
  );
  assert.ok(out !== undefined);
  assert.match(out, /^\[workflow\] failed · run-x/);
  assert.match(out, /\[Tool Error\]/);
});

test('leading whitespace tolerated', () => {
  const out = parseTaskCompletedNotice('\n\n  <task-completed task_id="r1">done');
  assert.ok(out !== undefined);
  assert.match(out, /^\[workflow\] completed · r1/);
});

test('non-task-completed content → undefined (falls through to normal handling)', () => {
  assert.equal(parseTaskCompletedNotice('just a normal user message'), undefined);
  assert.equal(parseTaskCompletedNotice('the assistant wrote <task-completed> inline'), undefined);
  // Missing task_id attribute is not a recognized result block.
  assert.equal(parseTaskCompletedNotice('<task-completed>no id</task-completed>'), undefined);
});

test('very long body is truncated with an ellipsis', () => {
  const long = 'x'.repeat(TASK_COMPLETED_BODY_MAX + 3000);
  const out = parseTaskCompletedNotice(`<task-completed task_id="r">${long}`);
  assert.ok(out !== undefined);
  assert.ok(out.length < TASK_COMPLETED_BODY_MAX + 200, 'body truncated to a sane length');
  assert.match(out, /…$/);
});
