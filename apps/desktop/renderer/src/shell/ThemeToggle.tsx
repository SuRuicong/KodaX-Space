// ThemeToggle — alpha.1
//
// Titlebar 右侧 dropdown — 三档主题快速切换：
//   ┌─────────────────────────┐
//   │ Theme       ⇧Ctrl T     │
//   │   ☀  Light              │
//   │   ◐  Dark         ✓     │
//   │   ◑  System             │
//   └─────────────────────────┘
//
// 行为：
//   - 点击图标按钮 → 弹下拉
//   - 下拉里选一项 → 立即切换 (apply <html> class + IPC titlebar.setOverlay)
//   - 关闭逻辑：点外 / Esc / 选完一项后自动关
//   - 快捷键 ⇧Ctrl+T (跟 VSCode "Reopen Closed Editor" 不冲突，因为我们没那命令)：循环 dark→light→system→dark
//
// 'system' 时读 prefers-color-scheme + 监听变化，跟随 OS。

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore.js';

const DARK_OVERLAY = { color: '#0b0b0c', symbolColor: '#a1a1aa' };
const LIGHT_OVERLAY = { color: '#ffffff', symbolColor: '#3f3f46' };

type ThemeKey = 'dark' | 'light' | 'system';

const OPTIONS: ReadonlyArray<{ key: ThemeKey; label: string; icon: string }> = [
  { key: 'light', label: 'Light', icon: '☀' },
  { key: 'dark', label: 'Dark', icon: '◐' },
  { key: 'system', label: 'System', icon: '◑' },
];

const CYCLE_ORDER: ReadonlyArray<ThemeKey> = ['dark', 'light', 'system'];

function getEffectiveTheme(theme: ThemeKey): 'dark' | 'light' {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }
  return theme;
}

export function applyThemeToDocument(theme: ThemeKey): void {
  const eff = getEffectiveTheme(theme);
  if (eff === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
  if (window.kodaxSpace) {
    void window.kodaxSpace.invoke(
      'titlebar.setOverlay',
      eff === 'dark' ? DARK_OVERLAY : LIGHT_OVERLAY,
    );
  }
}

export function ThemeToggle(): JSX.Element {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // 应用 theme + 监听 system 偏好变化
  useEffect(() => {
    applyThemeToDocument(theme);
    if (theme === 'system' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = (): void => applyThemeToDocument('system');
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
    return undefined;
  }, [theme]);

  // ⇧Ctrl+T 循环 + 点外/Esc 关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        // 循环到下一档
        const cur = useAppStore.getState().theme;
        const idx = CYCLE_ORDER.indexOf(cur);
        const next = CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length];
        setTheme(next);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    }
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocDown);
    };
  }, [setTheme]);

  const current = OPTIONS.find((o) => o.key === theme) ?? OPTIONS[1];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-fg-muted hover:text-fg-primary px-1.5 py-0.5 rounded hover:bg-hover-bg flex items-center gap-1"
        title={`Theme: ${current.label} (⇧Ctrl+T)`}
        aria-label={`Theme ${current.label}`}
      >
        <span aria-hidden>{current.icon}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 text-xs z-50">
          <div className="px-3 py-1 flex justify-between items-center text-zinc-500 text-[10px] uppercase tracking-wider">
            <span>Theme</span>
            <span className="font-mono text-zinc-400 flex items-center gap-1">
              <kbd className="px-1 border border-zinc-700 rounded">⇧</kbd>
              <kbd className="px-1 border border-zinc-700 rounded">Ctrl</kbd>
              <kbd className="px-1 border border-zinc-700 rounded">T</kbd>
            </span>
          </div>
          {OPTIONS.map((o) => {
            const selected = o.key === theme;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => {
                  setTheme(o.key);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1 hover:bg-zinc-800 flex items-center gap-2 ${
                  selected ? 'text-zinc-100' : 'text-zinc-300'
                }`}
              >
                <span className="w-4" aria-hidden>{o.icon}</span>
                <span className="flex-1">{o.label}</span>
                {selected && <span className="text-emerald-500" aria-hidden>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
