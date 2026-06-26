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
import { useI18n } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';

interface RecentsFilterMenuProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly anchorEl: HTMLElement | null;
}

const STATUS_OPTIONS: ReadonlyArray<{ key: RecentsFilter['status']; labelKey: MessageKey }> = [
  { key: 'active', labelKey: 'sidebar.filter.status.active' },
  { key: 'archived', labelKey: 'sidebar.filter.status.archived' },
  { key: 'all', labelKey: 'sidebar.filter.status.all' },
];

const ACTIVITY_OPTIONS: ReadonlyArray<{
  key: RecentsFilter['lastActivity'];
  labelKey: MessageKey;
}> = [
  { key: 'today', labelKey: 'sidebar.filter.activity.today' },
  { key: '7d', labelKey: 'sidebar.filter.activity.7d' },
  { key: '30d', labelKey: 'sidebar.filter.activity.30d' },
  { key: 'all', labelKey: 'sidebar.filter.activity.all' },
];

const SORT_OPTIONS: ReadonlyArray<{ key: RecentsFilter['sortBy']; labelKey: MessageKey }> = [
  { key: 'recency', labelKey: 'sidebar.filter.sort.recency' },
  { key: 'alphabetical', labelKey: 'sidebar.filter.sort.alphabetical' },
  { key: 'created', labelKey: 'sidebar.filter.sort.created' },
];

const GROUP_OPTIONS: ReadonlyArray<{ key: RecentsFilter['groupBy']; labelKey: MessageKey }> = [
  { key: 'none', labelKey: 'sidebar.filter.group.none' },
  { key: 'project', labelKey: 'sidebar.filter.group.project' },
  { key: 'status', labelKey: 'sidebar.filter.group.status' },
];

export function RecentsFilterMenu({
  open,
  onClose,
  anchorEl,
}: RecentsFilterMenuProps): JSX.Element | null {
  const { t } = useI18n();
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
        label={t('sidebar.filter.status')}
        valueKey={filter.status}
        options={STATUS_OPTIONS.map((o) => ({ key: o.key, label: t(o.labelKey) }))}
        onPick={(key) => setFilter({ ...filter, status: key })}
      />
      <FilterRow
        label={t('sidebar.filter.project')}
        valueKey={filter.projectScope}
        options={[
          { key: 'current', label: t('sidebar.filter.project.currentOnly') },
          { key: 'all', label: t('sidebar.filter.project.all') },
        ]}
        onPick={(key) =>
          setFilter({ ...filter, projectScope: key as RecentsFilter['projectScope'] })
        }
      />
      <FilterRow
        label={t('sidebar.filter.lastActivity')}
        valueKey={filter.lastActivity}
        options={ACTIVITY_OPTIONS.map((o) => ({ key: o.key, label: t(o.labelKey) }))}
        onPick={(key) => setFilter({ ...filter, lastActivity: key })}
      />
      <Divider />
      <FilterRow
        label={t('sidebar.filter.groupBy')}
        valueKey={filter.groupBy}
        options={GROUP_OPTIONS.map((o) => ({ key: o.key, label: t(o.labelKey) }))}
        onPick={(key) => setFilter({ ...filter, groupBy: key })}
      />
      <FilterRow
        label={t('sidebar.filter.sortBy')}
        valueKey={filter.sortBy}
        options={SORT_OPTIONS.map((o) => ({ key: o.key, label: t(o.labelKey) }))}
        onPick={(key) => setFilter({ ...filter, sortBy: key })}
      />
    </div>
  );
}

function FilterRow<T extends string>({
  label,
  valueKey,
  options,
  onPick,
}: {
  label: string;
  valueKey: T;
  options: ReadonlyArray<{ key: T; label: string }>;
  onPick: (key: T) => void;
}): JSX.Element {
  const { t } = useI18n();
  const value = options.find((o) => o.key === valueKey)?.label ?? '';
  // 简单 cycle：每次点击切到 options 数组的下一项
  function onCycle(): void {
    const idx = options.findIndex((o) => o.key === valueKey);
    const next = options[(idx + 1) % options.length];
    onPick(next.key);
  }
  return (
    <button
      type="button"
      onClick={onCycle}
      className="w-full text-left px-3 py-1 hover:bg-hover-bg flex items-center gap-2 text-fg-primary"
      title={t('sidebar.filter.clickToCycle')}
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
