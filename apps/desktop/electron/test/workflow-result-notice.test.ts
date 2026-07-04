// parseTaskCompletedBlocks + isWorkflowRunDir — workflow resume 位置修复(approach A)的核心。
// 关键回归:①一条合成消息里的多个 `<task-completed>` 块都要解析、各自剥干净(MEDIUM);
// ②`<task-completed>` wrapper 不是 workflow 独有(dispatch_child_task 同款),必须靠 run 目录核对(HIGH)。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseTaskCompletedBlocks,
  isWorkflowRunDir,
  TASK_COMPLETED_BODY_MAX,
} from '../ipc/workflow-result-notice.js';

test('single completed block: labeled + run-id tagged + wrapper stripped', () => {
  const [b, ...rest] = parseTaskCompletedBlocks(
    '<task-completed task_id="run-abc">\n# Review 报告\nbody line</task-completed>',
  );
  assert.equal(rest.length, 0);
  assert.equal(b?.runId, 'run-abc');
  assert.match(b?.text ?? '', /^\[workflow\] completed · run-abc/);
  assert.match(b?.text ?? '', /# Review 报告/);
  assert.doesNotMatch(b?.text ?? '', /<task-completed|<\/task-completed>/);
});

test('failure block → failed label', () => {
  const [b] = parseTaskCompletedBlocks(
    '<task-completed task_id="run-x"> [Tool Error] Workflow run-x failed: boom</task-completed>',
  );
  assert.match(b?.text ?? '', /^\[workflow\] failed · run-x/);
  assert.match(b?.text ?? '', /\[Tool Error\]/);
});

test('MULTIPLE batched blocks: each parsed separately, no inner tags leak (MEDIUM regression)', () => {
  const text =
    '<task-completed task_id="t1">summary one</task-completed>\n\n' +
    '<task-completed task_id="t2">summary two</task-completed>';
  const blocks = parseTaskCompletedBlocks(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.runId, 't1');
  assert.equal(blocks[1]?.runId, 't2');
  for (const b of blocks) {
    assert.doesNotMatch(b.text, /<task-completed|<\/task-completed>/, 'no wrapper tag leaks into body');
  }
  assert.match(blocks[0]?.text ?? '', /summary one/);
  assert.match(blocks[1]?.text ?? '', /summary two/);
});

test('leading whitespace tolerated; truncated (no closing tag) still parsed', () => {
  const [b] = parseTaskCompletedBlocks('\n\n  <task-completed task_id="r1">done, no close tag');
  assert.equal(b?.runId, 'r1');
  assert.match(b?.text ?? '', /^\[workflow\] completed · r1/);
});

test('non-task-completed content → [] (falls through to normal handling)', () => {
  assert.deepEqual(parseTaskCompletedBlocks('just a normal user message'), []);
  // Missing task_id attribute is not a recognized block.
  assert.deepEqual(parseTaskCompletedBlocks('<task-completed>no id</task-completed>'), []);
});

test('very long body truncated with an ellipsis', () => {
  const long = 'x'.repeat(TASK_COMPLETED_BODY_MAX + 3000);
  const [b] = parseTaskCompletedBlocks(`<task-completed task_id="r">${long}</task-completed>`);
  assert.ok((b?.text.length ?? 0) < TASK_COMPLETED_BODY_MAX + 200, 'truncated');
  assert.match(b?.text ?? '', /…$/);
});

test('isWorkflowRunDir: true only when the run directory exists; rejects path traversal', () => {
  const base = mkdtempSync(join(tmpdir(), 'wf-runbase-'));
  try {
    mkdirSync(join(base, 'run-real'));
    assert.equal(isWorkflowRunDir('run-real', base), true, 'existing run dir → workflow');
    assert.equal(isWorkflowRunDir('run-missing', base), false, 'no dir (e.g. dispatch_child_task) → not workflow');
    // path-traversal / unsafe ids are rejected before any fs access
    assert.equal(isWorkflowRunDir('../evil', base), false);
    assert.equal(isWorkflowRunDir('a/b', base), false);
    assert.equal(isWorkflowRunDir('', base), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
