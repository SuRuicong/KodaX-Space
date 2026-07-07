import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTaskDockSectionId } from '../../renderer/src/shell/taskDockControl.js';

test('task dock focus only accepts known section ids', () => {
  assert.equal(isTaskDockSectionId('plan'), true);
  assert.equal(isTaskDockSectionId('changes'), true);
  assert.equal(isTaskDockSectionId('missing-section'), false);
  assert.equal(isTaskDockSectionId(null), false);
});
