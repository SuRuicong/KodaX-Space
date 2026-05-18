// SlashCommandPopover — FEATURE_031.
//
// 用户在底部输入框输入 `/` 触发：
//   - 拉 slash.discover 一次（已缓存就不再拉）
//   - 显示命令列表 popover，过滤前缀
//   - 上下键选中、回车执行；Esc 关闭
//
// 不在 BottomBar 内部直接 inline 实现，独立组件方便 future 让 attach-menu 也复用同补全。

import { useEffect, useRef, useState } from 'react';
import type { SlashCommandMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

export interface SlashCommandPopoverProps {
  /** 当前输入框文本（含 leading `/`）。父组件按需 mount/unmount 本组件。*/
  readonly query: string;
  /**
   * 用户选中命令并按回车（或点击）后回调。父组件接管 input clear + IPC exec。
   * cmd === null 表示用户按 Esc 关闭弹窗。
   */
  readonly onPick: (cmd: SlashCommandMeta | null) => void;
}

let cachedCommands: SlashCommandMeta[] | null = null;

async function loadCommandsOnce(): Promise<SlashCommandMeta[]> {
  if (cachedCommands) return cachedCommands;
  if (!window.kodaxSpace) return [];
  const result = await window.kodaxSpace.invoke('slash.discover', undefined);
  if (!result.ok) return [];
  cachedCommands = [...result.data.commands];
  return cachedCommands;
}

/**
 * 测试用：清空缓存让下一次重新拉。
 * 生产构建 no-op，避免运行期被误调导致 popover 重新走一次 IPC discover。
 */
export function _resetSlashCacheForTesting(): void {
  if (process.env.NODE_ENV === 'production') return;
  cachedCommands = null;
}

export function SlashCommandPopover(props: SlashCommandPopoverProps): JSX.Element | null {
  const [commands, setCommands] = useState<readonly SlashCommandMeta[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const sessionId = useAppStore((s) => s.currentSessionId);
  const listRef = useRef<HTMLDivElement>(null);

  // 启动时拉一次命令列表
  useEffect(() => {
    void loadCommandsOnce().then(setCommands);
  }, []);

  // query 变化重置选中索引
  useEffect(() => {
    setSelectedIdx(0);
  }, [props.query]);

  // 过滤：去掉 leading `/`，前缀匹配命令名 (case-insensitive)。
  // KodaX REPL 用 starts-with 不用 fuzzy——简单可预测，符合 user 直觉。
  const prefix = props.query.replace(/^\//, '').toLowerCase();
  const filtered = commands.filter((c) => c.name.startsWith(prefix));

  // 上下键 / 回车 / Esc 键盘处理
  useEffect(() => {
    if (filtered.length === 0 && !prefix) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        const cmd = filtered[selectedIdx];
        if (cmd) {
          e.preventDefault();
          props.onPick(cmd);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        props.onPick(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, selectedIdx, prefix, props]);

  // 选中项 scroll-into-view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLDivElement>(`[data-slash-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (!sessionId) return null;
  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute left-3 right-3 bottom-full mb-1 max-h-64 overflow-y-auto bg-zinc-900 border border-zinc-800 rounded shadow-xl text-xs z-40"
      role="listbox"
      aria-label="Slash commands"
    >
      {filtered.map((c, idx) => {
        const selected = idx === selectedIdx;
        return (
          <div
            key={c.name}
            data-slash-idx={idx}
            role="option"
            aria-selected={selected}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onPick(c);
            }}
            onMouseEnter={() => setSelectedIdx(idx)}
            className={`px-3 py-1.5 flex items-center gap-3 cursor-pointer ${
              selected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-850'
            }`}
          >
            <span className="font-mono text-amber-300 min-w-[110px]">/{c.name}</span>
            {c.argsHint && (
              <span className="text-[10px] text-zinc-600 font-mono">{c.argsHint}</span>
            )}
            <span className="text-zinc-500 truncate">{c.description}</span>
            {c.source === 'user' && (
              <span className="ml-auto text-[9px] text-zinc-600 uppercase">user</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
