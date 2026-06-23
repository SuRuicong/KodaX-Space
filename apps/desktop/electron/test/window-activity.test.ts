import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserWindow } from 'electron';
import type { WindowActivityPayload } from '@kodax-space/space-ipc-schema';

import { getWindowActivityPayload, installWindowActivityPublisher } from '../window/activity.js';

function sourceState(input: {
  readonly destroyed?: boolean;
  readonly focused?: boolean;
  readonly visible?: boolean;
  readonly minimized?: boolean;
}) {
  return {
    isDestroyed: () => input.destroyed ?? false,
    isFocused: () => input.focused ?? false,
    isVisible: () => input.visible ?? false,
    isMinimized: () => input.minimized ?? false,
  };
}

test('getWindowActivityPayload resolves active, passive, and hidden states', () => {
  assert.deepEqual(getWindowActivityPayload(sourceState({ focused: true, visible: true })), {
    state: 'active',
    active: true,
    focused: true,
    visible: true,
    minimized: false,
  });
  assert.deepEqual(getWindowActivityPayload(sourceState({ focused: false, visible: true })), {
    state: 'passive',
    active: false,
    focused: false,
    visible: true,
    minimized: false,
  });
  assert.deepEqual(
    getWindowActivityPayload(sourceState({ focused: true, visible: true, minimized: true })),
    {
      state: 'hidden',
      active: false,
      focused: false,
      visible: false,
      minimized: true,
    },
  );
});

test('installWindowActivityPublisher publishes deduped state and force-resends after load', () => {
  const webContents = new EventEmitter();
  const win = new EventEmitter() as EventEmitter & {
    focused: boolean;
    visible: boolean;
    minimized: boolean;
    destroyed: boolean;
    webContents: EventEmitter;
    isDestroyed(): boolean;
    isFocused(): boolean;
    isVisible(): boolean;
    isMinimized(): boolean;
  };
  win.focused = true;
  win.visible = true;
  win.minimized = false;
  win.destroyed = false;
  win.webContents = webContents;
  win.isDestroyed = () => win.destroyed;
  win.isFocused = () => win.focused;
  win.isVisible = () => win.visible;
  win.isMinimized = () => win.minimized;

  const sent: WindowActivityPayload[] = [];
  const uninstall = installWindowActivityPublisher(
    win as unknown as BrowserWindow,
    (_channel, payload) => sent.push(payload),
  );

  try {
    webContents.emit('did-finish-load');
    assert.equal(sent.at(-1)?.state, 'active');

    win.focused = false;
    win.emit('blur');
    assert.equal(sent.at(-1)?.state, 'passive');
    const afterBlur = sent.length;
    win.emit('blur');
    assert.equal(sent.length, afterBlur);

    win.minimized = true;
    win.emit('minimize');
    assert.equal(sent.at(-1)?.state, 'hidden');

    webContents.emit('did-finish-load');
    assert.equal(sent.length, afterBlur + 2);
    assert.equal(sent.at(-1)?.state, 'hidden');
  } finally {
    uninstall();
  }
});
