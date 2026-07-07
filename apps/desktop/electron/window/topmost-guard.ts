import type { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';

export interface TopmostGuardWindow {
  isDestroyed(): boolean;
  isAlwaysOnTop(): boolean;
  setAlwaysOnTop(flag: boolean): void;
}

export interface TopmostGuardOptions {
  readonly label: string;
  readonly pollMs?: number;
  readonly warn?: (message: string) => void;
}

const DEFAULT_POLL_MS = 2500;
const TOPMOST_CHECK_EVENTS = ['always-on-top-changed', 'show', 'focus', 'restore', 'blur'] as const;

export function correctUnexpectedAlwaysOnTop(
  win: TopmostGuardWindow,
  label: string,
  warn: (message: string) => void = (message) => console.warn(message),
): boolean {
  if (win.isDestroyed()) return false;
  if (!win.isAlwaysOnTop()) return false;
  win.setAlwaysOnTop(false);
  warn(`[window] cleared unexpected always-on-top state for ${label}`);
  return true;
}

export function installTopmostGuard(
  win: BrowserWindow,
  options: TopmostGuardOptions,
): () => void {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const check = (): void => {
    correctUnexpectedAlwaysOnTop(win, options.label, warn);
  };
  const events = win as unknown as EventEmitter;
  for (const eventName of TOPMOST_CHECK_EVENTS) {
    events.on(eventName, check);
  }

  check();
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const interval = pollMs > 0 ? setInterval(check, pollMs) : null;
  interval?.unref?.();

  return () => {
    for (const eventName of TOPMOST_CHECK_EVENTS) {
      events.removeListener(eventName, check);
    }
    if (interval !== null) clearInterval(interval);
  };
}
