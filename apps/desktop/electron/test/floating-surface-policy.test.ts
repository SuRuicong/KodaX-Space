import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  floatingSurfaceForBlockingModal,
  floatingSurfaceForPopout,
  isFloatingPopoutKind,
} from '../../renderer/src/shell/floatingSurfacePolicy.js';
import {
  floatingSurfaceBehavior,
  floatingSurfaceStackTopToken,
  floatingSurfaceZIndex,
} from '../../renderer/src/shell/FloatingSurfaceHost.js';

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

test('floating surface policy rejects and safely falls back for unknown popout kinds', () => {
  assert.equal(isFloatingPopoutKind('plan'), true);
  assert.equal(isFloatingPopoutKind('missing-popout'), false);

  const surface = floatingSurfaceForPopout('missing-popout' as never);
  assert.equal(surface.kind, 'dock_sheet');
  assert.equal(surface.label, 'Activity');
});

test('floating surface host gives review workspaces a soft backdrop and Escape close', () => {
  const behavior = floatingSurfaceBehavior(floatingSurfaceForPopout('diff'));

  assert.equal(behavior.hasBackdrop, true);
  assert.equal(behavior.closeOnEscape, true);
  assert.equal(behavior.closeOnBackdrop, false);
  assert.equal(behavior.moveFocus, true);
  assert.equal(behavior.trapFocus, false);
});

test('floating surface host keeps routine dock sheets non-modal', () => {
  const behavior = floatingSurfaceBehavior(floatingSurfaceForPopout('terminal'));

  assert.equal(behavior.hasBackdrop, false);
  assert.equal(behavior.closeOnEscape, false);
  assert.equal(behavior.trapFocus, false);
  assert.equal(floatingSurfaceZIndex(floatingSurfaceForPopout('terminal')), 86);
});

test('floating surface host traps decision-required blocking modals without owning Escape', () => {
  const surface = floatingSurfaceForBlockingModal('permission-modal', 'Permission');
  const behavior = floatingSurfaceBehavior(surface);

  assert.equal(surface.kind, 'blocking_modal');
  assert.equal(behavior.hasBackdrop, true);
  assert.equal(behavior.closeOnEscape, false);
  assert.equal(behavior.closeOnBackdrop, false);
  assert.equal(behavior.trapFocus, true);
  assert.equal(behavior.restoreFocus, true);
  assert.equal(floatingSurfaceZIndex(surface), 300);
});

test('floating surface host lets confirm-style modals dismiss on outside or Escape', () => {
  const behavior = floatingSurfaceBehavior(
    floatingSurfaceForBlockingModal('confirm-dialog', 'Confirm', 'outside_or_escape'),
  );

  assert.equal(behavior.closeOnEscape, true);
  assert.equal(behavior.closeOnBackdrop, true);
  assert.equal(behavior.trapFocus, true);
});

test('floating surface stack chooses highest z-index, then latest mount order', () => {
  assert.equal(
    floatingSurfaceStackTopToken([
      { token: 'review', zIndex: 90, order: 1 },
      { token: 'permission', zIndex: 300, order: 2 },
      { token: 'confirm', zIndex: 300, order: 3 },
    ]),
    'confirm',
  );

  assert.equal(
    floatingSurfaceStackTopToken([
      { token: 'new-dock-sheet', zIndex: 82, order: 10 },
      { token: 'review', zIndex: 90, order: 1 },
    ]),
    'review',
  );
});
