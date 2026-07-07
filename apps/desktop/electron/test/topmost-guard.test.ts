import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserWindow } from 'electron';

import { correctUnexpectedAlwaysOnTop, installTopmostGuard } from '../window/topmost-guard.js';

test('correctUnexpectedAlwaysOnTop clears unexpected topmost state', () => {
  const warnings: string[] = [];
  const win = {
    topmost: true,
    isDestroyed: () => false,
    isAlwaysOnTop() {
      return this.topmost;
    },
    setAlwaysOnTop(flag: boolean) {
      this.topmost = flag;
    },
  };

  assert.equal(
    correctUnexpectedAlwaysOnTop(win, 'test window', (message) => warnings.push(message)),
    true,
  );
  assert.equal(win.topmost, false);
  assert.match(warnings[0] ?? '', /test window/);
});

test('correctUnexpectedAlwaysOnTop leaves normal windows alone', () => {
  let writes = 0;
  const win = {
    isDestroyed: () => false,
    isAlwaysOnTop: () => false,
    setAlwaysOnTop: () => {
      writes++;
    },
  };

  assert.equal(correctUnexpectedAlwaysOnTop(win, 'normal'), false);
  assert.equal(writes, 0);
});

test('installTopmostGuard checks on focus events and unregisters cleanly', () => {
  const win = new EventEmitter() as EventEmitter & {
    topmost: boolean;
    destroyed: boolean;
    isDestroyed(): boolean;
    isAlwaysOnTop(): boolean;
    setAlwaysOnTop(flag: boolean): void;
  };
  win.topmost = false;
  win.destroyed = false;
  win.isDestroyed = () => win.destroyed;
  win.isAlwaysOnTop = () => win.topmost;
  win.setAlwaysOnTop = (flag) => {
    win.topmost = flag;
  };

  const uninstall = installTopmostGuard(win as unknown as BrowserWindow, {
    label: 'evented',
    pollMs: 0,
    warn: () => undefined,
  });
  win.topmost = true;
  win.emit('always-on-top-changed');
  assert.equal(win.topmost, false);

  win.topmost = true;
  win.emit('focus');
  assert.equal(win.topmost, false);

  uninstall();
  win.topmost = true;
  win.emit('focus');
  assert.equal(win.topmost, true);
});
