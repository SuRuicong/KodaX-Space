import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floatingSurfaceForPopout } from '../../renderer/src/shell/floatingSurfacePolicy.js';

test('floating surface policy classifies diff as review workspace', () => {
  const surface = floatingSurfaceForPopout('diff');
  assert.equal(surface.kind, 'review_workspace');
  assert.equal(surface.placement, 'full_height_workspace');
  assert.equal(surface.canAutoOpen, false);
});

test('floating surface policy classifies artifact and terminal as dedicated workspaces', () => {
  assert.equal(floatingSurfaceForPopout('artifact').kind, 'artifact_workspace');
  assert.equal(floatingSurfaceForPopout('terminal').kind, 'terminal_workspace');
});

test('floating surface policy keeps plan/tasks/workflow as dock sheets', () => {
  for (const kind of ['plan', 'tasks', 'workflow'] as const) {
    const surface = floatingSurfaceForPopout(kind);
    assert.equal(surface.kind, 'dock_sheet', kind);
    assert.equal(surface.modality, 'none', kind);
    assert.equal(surface.canAutoOpen, false, kind);
  }
});
