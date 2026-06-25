// HelpOverlay — P3
//
// `?` 在非 input 上下文时触发，弹一个键盘 + slash 命令 cheat sheet。
// 对齐 KodaX TUI 的 `?` overlay 行为：列分组的快捷键 + 当前可用 slash 命令。
//
// 跨平台快捷键显示：data 里用 `Mod` sentinel 表示"平台主修饰键"；formatKey 在
// Mac 上翻译成 ⌘，Win/Linux 上是 Ctrl。Alt/Shift/Meta 同理。

import { useEffect, useMemo, useState } from 'react';
import { formatKey, getPlatform } from '../lib/shortcut-format.js';

interface ShortcutGroup {
  readonly title: string;
  readonly items: ReadonlyArray<{ keys: readonly string[]; label: string }>;
}

const GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Input',
    items: [
      { keys: ['Enter'], label: 'Send message' },
      { keys: ['Shift', 'Enter'], label: 'Insert newline' },
      { keys: ['↑'], label: 'Previous prompt (history)' },
      { keys: ['↓'], label: 'Next prompt / restore draft' },
      { keys: ['/'], label: 'Open slash command picker' },
    ],
  },
  {
    title: 'Modes',
    items: [
      { keys: ['Shift', 'Tab'], label: 'Cycle permission mode (Plan / Edits / Auto)' },
      { keys: ['Ctrl', 'M'], label: 'Open permission mode picker' },
      { keys: ['Ctrl', 'Shift', 'E'], label: 'Cycle reasoning depth' },
      { keys: ['Alt', 'M'], label: 'Toggle agent mode (AMA / AMAW / SA)' },
    ],
  },
  {
    title: 'Session',
    items: [
      { keys: ['Esc'], label: 'Cancel / close overlay' },
      { keys: ['/clear'], label: 'Clear current conversation view' },
      { keys: ['/new'], label: 'Start a new session' },
      { keys: ['/fork'], label: 'Fork from session menu (right-click a session)' },
    ],
  },
  {
    title: 'UI',
    items: [
      { keys: ['Mod', 'K'], label: 'Quick Ask (temporary question)' },
      {
        keys: ['Mod', 'Shift', 'P'],
        label: 'Command palette (actions / sessions / files / slash)',
      },
      { keys: ['Ctrl', 'Shift', 'T'], label: 'Cycle theme (Dark / Light / System)' },
      { keys: ['Mod', 'F'], label: 'Find in transcript (↑/↓ to nav)' },
      { keys: ['Ctrl', '\\'], label: 'Toggle focus mode (hide sidebars)' },
      { keys: ['?'], label: 'Toggle this help overlay' },
    ],
  },
  {
    title: 'Slash commands (also via /)',
    items: [
      { keys: ['/help'], label: 'List all commands' },
      { keys: ['/mode'], label: 'Set permission mode' },
      { keys: ['/agent-mode'], label: 'Set agent mode (ama / sa)' },
      { keys: ['/provider'], label: 'Switch provider' },
      { keys: ['/model'], label: 'Switch model for next turn' },
      { keys: ['/reasoning'], label: 'Set reasoning depth' },
      { keys: ['/thinking'], label: 'Toggle thinking output' },
      { keys: ['/copy'], label: 'Copy last assistant message' },
      { keys: ['/cost'], label: 'Show token usage' },
      { keys: ['/tree'], label: 'Show session lineage' },
      { keys: ['/history'], label: 'Show user message history' },
      { keys: ['/compact'], label: 'Compact context on next turn' },
      { keys: ['/clear'], label: 'Clear conversation' },
    ],
  },
];

/** Global `?` shortcut toggles the overlay. Returns the overlay node (or null when closed). */
export function HelpOverlayController(): JSX.Element | null {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 仅在非输入控件触发，避免 user 在 textarea / input 里输入 ? 被打断
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      const isInputContext = tag === 'input' || tag === 'textarea' || target?.isContentEditable;
      if (e.key === '?' && !isInputContext && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    const onOpen = (): void => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('kodax-space.open-help', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('kodax-space.open-help', onOpen);
    };
  }, [open]);

  // platform 在挂载后稳定，useMemo 单次解析
  const platform = useMemo(() => getPlatform(), []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-surface border border-border-default rounded-lg shadow-2xl max-w-2xl w-[90vw] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-border-default flex items-center justify-between sticky top-0 bg-surface">
          <h2 className="text-sm font-semibold text-fg-primary">
            Keyboard shortcuts &amp; commands
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-fg-muted hover:text-fg-primary text-xs px-2 py-0.5"
            aria-label="Close help"
          >
            Esc
          </button>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 p-4">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="text-[11px] uppercase tracking-wider text-fg-muted mb-2">{g.title}</h3>
              <ul className="space-y-1.5 text-xs">
                {g.items.map((it) => (
                  // GROUPS 是 module-level const，label 字符串足够稳定唯一作 key —
                  // 比 array index 更经得起未来 GROUPS 重排时的 React 重用 (review LOW)
                  <li key={it.label} className="flex items-center justify-between gap-2">
                    <span className="text-fg-secondary truncate">{it.label}</span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {it.keys.map((k) => (
                        <kbd
                          // 单 shortcut 内 key 序列各 modifier+letter 已天然唯一
                          key={k}
                          className="px-1.5 py-0.5 border border-border-default rounded bg-surface-2 text-fg-primary text-[11px] font-mono"
                        >
                          {formatKey(k, platform)}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
