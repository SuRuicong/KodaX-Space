// RecentsFilterMenu — alpha.1
//
// Claude Desktop 截图 3：Recents 标题右侧 ⚙ 按钮，点击弹出：
//   Status   > Active        (Active / Archived / All)
//   Project  > All            (按 currentProjectPath 过滤；All 显示所有)
//   Environment > All         (alpha.1 占位 - Space 无 env 概念)
//   Last activity > All       (今天 / 7d / 30d / All)
//   ──────────────
//   Group by > None           (None / Project / Status)
//   Sort by  > Recency        (Recency / Alphabetical / Created)
//
// Space alpha.1 状态：本地 zustand 状态控制 visible filter 集合，不持久化。

import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore.js';
import { Caret } from '../components/Caret.js';
import type { RecentsFilter } from '../store/appStore.js';

interface RecentsFilterMenuProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly anchorEl: HTMLElement | null;
}

const STATUS_OPTIONS: ReadonlyArray<{ key: RecentsFilter['status']; label: string }> = [
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];

const ACTIVITY_OPTIONS: ReadonlyArray<{ key: RecentsFilter['lastActivity']; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All' },
];

const SORT_OPTIONS: ReadonlyArray<{ key: RecentsFilter['sortBy']; label: string }> = [
  { key: 'recency', label: 'Recency' },
  { key: 'alphabetical', label: 'Alphabetical' },
  { key: 'created', label: 'Created' },
];

const GROUP_OPTIONS: ReadonlyArray<{ key: RecentsFilter['groupBy']; label: string }> = [
  { key: 'none', label: 'None' },
  { key: 'project', label: 'Project' },
  { key: 'status', label: 'Status' },
];

export function RecentsFilterMenu({
  open,
  onClose,
  anchorEl,
}: RecentsFilterMenuProps): JSX.Element | null {
  const filter = useAppStore((s) => s.recentsFilter);
  const setFilter = useAppStore((s) => s.setRecentsFilter);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent): void {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && !(anchorEl?.contains(t) ?? false)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorEl]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="absolute left-2 top-8 w-56 bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 text-xs z-50"
      role="menu"
    >
      <FilterRow
        label="Status"
        value={STATUS_OPTIONS.find((o) => o.key === filter.status)?.label ?? ''}
        options={STATUS_OPTIONS}
        onPick={(key) => setFilter({ ...filter, status: key })}
      />
      <FilterRow
        label="Project"
        value={filter.projectScope === 'current' ? 'Current only' : 'All'}
        options={[
          { key: 'current', label: 'Current only' },
          { key: 'all', label: 'All' },
        ]}
        onPick={(key) =>
          setFilter({ ...filter, projectScope: key as RecentsFilter['projectScope'] })
        }
      />
      <FilterRow
        label="Last activity"
        value={ACTIVITY_OPTIONS.find((o) => o.key === filter.lastActivity)?.label ?? ''}
        options={ACTIVITY_OPTIONS}
        onPick={(key) => setFilter({ ...filter, lastActivity: key })}
      />
      <Divider />
      <FilterRow
        label="Group by"
        value={GROUP_OPTIONS.find((o) => o.key === filter.groupBy)?.label ?? ''}
        options={GROUP_OPTIONS}
        onPick={(key) => setFilter({ ...filter, groupBy: key })}
      />
      <FilterRow
        label="Sort by"
        value={SORT_OPTIONS.find((o) => o.key === filter.sortBy)?.label ?? ''}
        options={SORT_OPTIONS}
        onPick={(key) => setFilter({ ...filter, sortBy: key })}
      />
    </div>
  );
}

function FilterRow<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ key: T; label: string }>;
  onPick: (key: T) => void;
}): JSX.Element {
  // 简单 cycle：每次点击切到 options 数组的下一项
  function onCycle(): void {
    const idx = options.findIndex((o) => o.label === value);
    const next = options[(idx + 1) % options.length];
    onPick(next.key);
  }
  return (
    <button
      type="button"
      onClick={onCycle}
      className="w-full text-left px-3 py-1 hover:bg-hover-bg flex items-center gap-2 text-fg-primary"
      title="Click to cycle"
    >
      <span className="flex-1">{label}</span>
      <span className="text-fg-muted text-[11px]">{value}</span>
      <Caret open={false} className="text-fg-muted" />
    </button>
  );
}

function Divider(): JSX.Element {
  return <div className="border-t border-border-default my-1" />;
}
