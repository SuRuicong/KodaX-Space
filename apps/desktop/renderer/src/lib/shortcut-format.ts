// Cross-platform display helper for keyboard shortcuts.
//
// Shortcut data uses sentinel `'Mod'` for the platform's primary modifier
// (Cmd on darwin, Ctrl elsewhere). This file translates to display strings
// at render time so the data layer stays platform-agnostic.

export type Platform = 'darwin' | 'win32' | 'linux' | 'other';

/** Resolve platform from preload-injected `window.kodaxSpace.platform`.
 *  Cast 避开 Window 类型扩展 — 这文件被 electron tsconfig 通过单测链路拖进来，
 *  那边没 renderer 的 global.d.ts。运行时 window.kodaxSpace 永远存在。 */
export function getPlatform(): Platform {
  if (typeof window === 'undefined') return 'other';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (window as any).kodaxSpace?.platform as string | undefined;
  if (p === 'darwin') return 'darwin';
  if (p === 'win32') return 'win32';
  if (p === 'linux') return 'linux';
  return 'other';
}

/** Translate one key sentinel to its display form on the current platform. */
export function formatKey(key: string, platform: Platform): string {
  if (key === 'Mod') return platform === 'darwin' ? '⌘' : 'Ctrl';
  if (key === 'Alt') return platform === 'darwin' ? '⌥' : 'Alt';
  if (key === 'Shift') return platform === 'darwin' ? '⇧' : 'Shift';
  if (key === 'Meta') return platform === 'darwin' ? '⌘' : 'Win';
  return key;
}
