// SlashCommandPopover — FEATURE_031 + FEATURE_035.
//
// 用户在底部输入框输入 `/` 触发：
//   - 拉 slash.discover + skill.discover 各一次（已缓存就不再拉）
//   - 合并显示：slash command 与 skill 并列，按 name 字典序
//   - 上下键选中、回车执行；Esc 关闭
//
// 不在 BottomBar 内部直接 inline 实现，独立组件方便 future 让 attach-menu 也复用同补全。

import { useEffect, useRef, useState } from 'react';
import type { SlashCommandMeta, SkillMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

/**
 * 统一的 picker 项类型——把 slash command 和 skill 合并成一个列表。
 *   - kind 'slash' → BottomBar 走 slash.exec
 *   - kind 'skill' → BottomBar 走 skill.invoke → session.send
 */
export type SlashPickerItem =
  | { readonly kind: 'slash'; readonly meta: SlashCommandMeta }
  | { readonly kind: 'skill'; readonly meta: SkillMeta };

export interface SlashCommandPopoverProps {
  /** 当前输入框文本（含 leading `/`）。父组件按需 mount/unmount 本组件。*/
  readonly query: string;
  /**
   * 用户选中条目并按回车（或点击）后回调。父组件接管 input clear + IPC exec。
   * item === null 表示用户按 Esc 关闭弹窗。
   */
  readonly onPick: (item: SlashPickerItem | null) => void;
}

let cachedCommands: SlashCommandMeta[] | null = null;
// FEATURE_035: skill 缓存 per-session—— skill list 由 projectRoot 决定，
// 切 session 可能进了不同 project（不同 .kodax/skills/）。
let cachedSkills: { projectRoot: string; list: SkillMeta[] } | null = null;

async function loadCommandsOnce(): Promise<SlashCommandMeta[]> {
  if (cachedCommands) return cachedCommands;
  if (!window.kodaxSpace) return [];
  const result = await window.kodaxSpace.invoke('slash.discover', undefined);
  if (!result.ok) return [];
  cachedCommands = [...result.data.commands];
  return cachedCommands;
}

async function loadSkillsForProject(
  projectRoot: string,
  forceReload: boolean,
): Promise<SkillMeta[]> {
  if (!forceReload && cachedSkills && cachedSkills.projectRoot === projectRoot) {
    return cachedSkills.list;
  }
  if (!window.kodaxSpace) return [];
  // v0.1.10 fix: 用户跑 skill-creator 生成新 skill 后, 之前要重启 Space 才能 / 补全;
  // 现在 popover mount 都 forceReload, IPC main 端清 wrapper cache 重 scan 磁盘。
  const result = await window.kodaxSpace.invoke('skill.discover', {
    projectRoot,
    ...(forceReload ? { forceReload: true } : {}),
  });
  if (!result.ok) {
    cachedSkills = { projectRoot, list: [] };
    return [];
  }
  cachedSkills = { projectRoot, list: [...result.data.skills] };
  return cachedSkills.list;
}

/**
 * 测试用：清空缓存让下一次重新拉。
 * 生产构建 no-op，避免运行期被误调导致 popover 重新走一次 IPC discover。
 */
export function _resetSlashCacheForTesting(): void {
  if (import.meta.env.PROD) return;
  cachedCommands = null;
  cachedSkills = null;
}

export function SlashCommandPopover(props: SlashCommandPopoverProps): JSX.Element | null {
  const [items, setItems] = useState<readonly SlashPickerItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const listRef = useRef<HTMLDivElement>(null);

  // 启动时拉两份：slash + skills，合成 unified picker list（按 name 字典序）
  useEffect(() => {
    if (!projectRoot) {
      setItems([]);
      return;
    }
    let cancelled = false;
    // v0.1.10 fix: forceReload=true 让用户跑 skill-creator 后立即可见 (跳 60s cache TTL)。
    // Popover mount 是用户主动按 `/` 触发, 每次 force scan 用户体感无延迟 (SDK discover ~10ms)。
    void Promise.all([loadCommandsOnce(), loadSkillsForProject(projectRoot, true)]).then(
      ([cmds, skills]) => {
        if (cancelled) return;
        const merged: SlashPickerItem[] = [
          ...cmds.map((c): SlashPickerItem => ({ kind: 'slash', meta: c })),
          ...skills.map((s): SlashPickerItem => ({ kind: 'skill', meta: s })),
        ];
        merged.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
        setItems(merged);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  // query 变化重置选中索引
  useEffect(() => {
    setSelectedIdx(0);
  }, [props.query]);

  // v0.1.10 fix: 跟 KodaX REPL 对齐 — `/skill:<name>` 显式 namespace skill。
  // Filter 模式两条:
  //   - 用户输入 `/skill:<前缀>` → 只列 skills, 前缀匹配 skill name
  //   - 用户输入 `/<前缀>`        → 同时列 slash commands + skills (前缀匹配 name)
  // 这样 KodaX 老用户的 `/skill:foo` muscle memory work, Space 用户的 `/foo` 也 work。
  const queryLower = props.query.toLowerCase();
  const skillNamespaceMatch = queryLower.match(/^\/skill:(.*)$/);
  const skillOnlyMode = skillNamespaceMatch !== null;
  const prefix = skillOnlyMode ? skillNamespaceMatch[1]! : queryLower.replace(/^\//, '');
  const filtered = items.filter((c) => {
    if (skillOnlyMode && c.kind !== 'skill') return false;
    return c.meta.name.startsWith(prefix);
  });

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
        const item = filtered[selectedIdx];
        if (item) {
          e.preventDefault();
          props.onPick(item);
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

  if (!projectRoot) return null;
  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute left-3 right-3 bottom-full mb-1 max-h-64 overflow-y-auto bg-surface-4 border border-border-default rounded-lg shadow-xl text-xs z-40"
      role="listbox"
      aria-label="Slash commands and skills"
    >
      {filtered.map((item, idx) => {
        const selected = idx === selectedIdx;
        const m = item.meta;
        const argsHint = item.kind === 'slash' ? item.meta.argsHint : item.meta.argumentHint;
        return (
          <div
            key={`${item.kind}:${m.name}`}
            data-slash-idx={idx}
            role="option"
            aria-selected={selected}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onPick(item);
            }}
            onMouseEnter={() => setSelectedIdx(idx)}
            className={`px-3 py-1.5 flex items-center gap-3 cursor-pointer ${
              selected ? 'bg-surface-3 text-fg-primary' : 'text-fg-muted hover:bg-hover-bg'
            }`}
          >
            <span
              className={`font-mono min-w-[140px] ${
                item.kind === 'skill' ? 'text-run' : 'text-warn'
              }`}
            >
              {/* v0.1.10 fix: skill 显示成 `/skill:<name>` 对齐 KodaX REPL namespace;
                  slash command 仍 `/<name>` 紧凑显示 */}
              {item.kind === 'skill' ? `/skill:${m.name}` : `/${m.name}`}
            </span>
            {argsHint && <span className="text-[11px] text-fg-faint font-mono">{argsHint}</span>}
            <span className="text-fg-muted truncate">{m.description}</span>
            <span className="ml-auto text-[9px] text-fg-faint uppercase">
              {item.kind === 'slash'
                ? item.meta.source === 'user'
                  ? 'user'
                  : ''
                : item.meta.source}
            </span>
          </div>
        );
      })}
    </div>
  );
}
