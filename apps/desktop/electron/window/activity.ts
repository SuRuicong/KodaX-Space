import type { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import type { WindowActivityPayload } from '@kodax-space/space-ipc-schema';
import { pushToRenderer } from '../ipc/push.js';

export interface WindowActivitySource {
  isDestroyed(): boolean;
  isFocused(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
}

type WindowActivityPush = (channel: 'window.activity', payload: WindowActivityPayload) => void;

const WINDOW_ACTIVITY_EVENTS = ['focus', 'blur', 'show', 'hide', 'minimize', 'restore'] as const;

export function getWindowActivityPayload(win: WindowActivitySource): WindowActivityPayload {
  if (win.isDestroyed()) {
    return {
      state: 'hidden',
      active: false,
      focused: false,
      visible: false,
      minimized: false,
    };
  }

  const minimized = win.isMinimized();
  const visible = win.isVisible() && !minimized;
  const focused = visible && win.isFocused();
  const state = !visible ? 'hidden' : focused ? 'active' : 'passive';

  return {
    state,
    active: state === 'active',
    focused,
    visible,
    minimized,
  };
}

export function installWindowActivityPublisher(
  win: BrowserWindow,
  push: WindowActivityPush = pushToRenderer,
): () => void {
  let lastPayloadKey: string | null = null;

  const publish = (force = false): void => {
    if (win.isDestroyed()) return;
    const payload = getWindowActivityPayload(win);
    const key = JSON.stringify(payload);
    if (!force && key === lastPayloadKey) return;
    lastPayloadKey = key;
    push('window.activity', payload);
  };

  const publishIfChanged = (): void => publish(false);
  const publishAfterLoad = (): void => publish(true);
  const windowEvents = win as unknown as EventEmitter;

  for (const eventName of WINDOW_ACTIVITY_EVENTS) {
    windowEvents.on(eventName, publishIfChanged);
  }
  win.webContents.on('did-finish-load', publishAfterLoad);

  return () => {
    for (const eventName of WINDOW_ACTIVITY_EVENTS) {
      windowEvents.removeListener(eventName, publishIfChanged);
    }
    win.webContents.removeListener('did-finish-load', publishAfterLoad);
  };
}
