// QueueIndicator - combined queue observability UI (v0.1.x)
//
// Shows a live snapshot of SDK process-global MessageQueue entries, including
// Space-owned follow-up prompts protected by per-session owner guards. Renderer state is fed by
// App.tsx via 'kodax.queueChanged'; clicking the badge only reads the store.
// Empty queues stay hidden so the toolbar does not reserve space.
import { useState } from 'react';
import { Hourglass } from 'lucide-react';
import { useAppStore } from '../store/appStore.js';
import { Caret } from '../components/Caret.js';
import type { QueuedMessageT, MessageModeT } from '@kodax-space/space-ipc-schema';
import { useI18n } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';

const PRIORITY_COLOR: Record<QueuedMessageT['priority'], string> = {
  user: 'text-warn',
  background: 'text-fg-muted',
};
const MODE_LABEL: Record<QueuedMessageT['mode'], string> = {
  prompt: 'prompt',
  'task-notification': 'task',
  'system-reminder': 'system',
};
const QUEUE_MODE_LABEL: Record<NonNullable<QueuedMessageT['queueMode']>, string> = {
  interrupt: 'interrupt',
  'after-turn': 'after-turn',
};

// Filter UI: 'all' / 'prompt' / 'task-notification' / 'system-reminder'
type FilterMode = 'all' | MessageModeT;
const FILTER_LABEL_KEY: Record<FilterMode, MessageKey> = {
  all: 'queue.filter.all',
  prompt: 'queue.filter.prompt',
  'task-notification': 'queue.filter.task',
  'system-reminder': 'queue.filter.system',
};

export function QueueIndicator(): JSX.Element | null {
  const { t } = useI18n();
  const snapshot = useAppStore((s) => s.queueSnapshot);
  const total = useAppStore((s) => s.queueTotalSize);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');

  if (total === 0) return null; // 空队列不占位

  // 按 filter 切片 snapshot;'all' 不过滤
  const filtered = filter === 'all' ? snapshot : snapshot.filter((m) => m.mode === filter);
  // 各 mode 的计数 (用来给 filter 按钮加 badge 数字,空 mode 不显示按钮)
  const modeCounts: Record<MessageModeT, number> = {
    prompt: 0,
    'task-notification': 0,
    'system-reminder': 0,
  };
  for (const m of snapshot) modeCounts[m.mode] += 1;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] font-mono flex items-center gap-1 text-fg-secondary hover:text-fg-primary"
        title={t('queue.tooltip', { count: total })}
        aria-label={t('queue.viewAria')}
      >
        <Hourglass className="w-3 h-3" strokeWidth={2} aria-hidden />
        <span>{t('queue.button', { count: total })}</span>
        <Caret open={false} className="text-fg-muted" />
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-full mb-2 w-96 max-h-80 overflow-auto bg-surface-4 border border-border-default rounded-lg shadow-xl p-3 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="text-fg-muted text-[11px] uppercase tracking-wider mb-2 flex justify-between">
            <span>{t('queue.title')}</span>
            <span>{t('queue.total', { count: total })}</span>
          </div>
          {/* Mode filter tabs: 只显示当前有内容的 mode + 'all' */}
          <div className="flex gap-1 mb-2 flex-wrap">
            {(['all', 'prompt', 'task-notification', 'system-reminder'] as const).map((m) => {
              const count = m === 'all' ? snapshot.length : modeCounts[m];
              // 不显示 0 count 的 mode 按钮 (except 'all' 用作 reset)
              if (m !== 'all' && count === 0) return null;
              const isActive = filter === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFilter(m)}
                  className={`px-2 py-0.5 text-[11px] rounded ${
                    isActive
                      ? 'bg-surface-3 text-fg-primary'
                      : 'text-fg-muted hover:text-fg-primary hover:bg-hover-bg'
                  }`}
                >
                  {t(FILTER_LABEL_KEY[m])}{' '}
                  {count > 0 && <span className="text-fg-muted">{count}</span>}
                </button>
              );
            })}
          </div>
          {filtered.length === 0 ? (
            <div className="text-fg-muted italic">
              {filter === 'all'
                ? t('queue.emptyAll')
                : t('queue.emptyFilter', { filter: t(FILTER_LABEL_KEY[filter]) })}
            </div>
          ) : (
            <ul className="space-y-2">
              {filtered.map((m) => (
                <li key={m.id} className="border-b border-border-default pb-2 last:border-b-0">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={PRIORITY_COLOR[m.priority]}>{m.priority}</span>
                    <span className="text-fg-muted">·</span>
                    <span className="text-fg-muted">{MODE_LABEL[m.mode]}</span>
                    {m.queueMode !== undefined && (
                      <>
                        <span className="text-fg-muted">·</span>
                        <span className="text-warn">{QUEUE_MODE_LABEL[m.queueMode]}</span>
                      </>
                    )}
                    {m.agentId !== undefined && (
                      <>
                        <span className="text-fg-muted">·</span>
                        <span className="text-fg-muted font-mono truncate" title={m.agentId}>
                          {m.agentId.slice(0, 16)}
                        </span>
                      </>
                    )}
                    <span className="text-fg-faint ml-auto">{formatTime(m.enqueuedAt, t)}</span>
                  </div>
                  <div className="mt-1 text-fg-secondary break-words" title={m.content}>
                    {m.content.length > 200 ? m.content.slice(0, 200) + '…' : m.content}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t border-border-default pt-2 text-[11px] text-fg-muted leading-relaxed">
            {t('queue.readOnlyNote')}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(
  ts: number,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return t('right.now');
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
