// QueueIndicator — KodaX SDK MessageQueue 可观察 UI (v0.1.x)
//
// 暴露 KodaX 进程内 process-global MessageQueue (FEATURE_115/159) 的实时状态:
//   - badge: 当前队列总长度 (主线程 + 所有 subagent 累计)
//   - 点击 → 弹出 popover 列出每条消息 (priority / mode / agentId / content 预览 / enqueuedAt)
//
// 数据来源: appStore.queueSnapshot + queueTotalSize,由 App.tsx 订阅 'kodax.queueChanged'
// push 自动更新。点击 badge 时不需要再发 IPC,直接读 store。
//
// 队列为空 (totalSize === 0) → 不显示,免得占视觉位置。

import { useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import type { QueuedMessageT } from '@kodax-space/space-ipc-schema';

const PRIORITY_COLOR: Record<QueuedMessageT['priority'], string> = {
  user: 'text-amber-300',
  background: 'text-zinc-400',
};
const MODE_LABEL: Record<QueuedMessageT['mode'], string> = {
  'prompt': 'prompt',
  'task-notification': 'task',
  'system-reminder': 'system',
};

export function QueueIndicator(): JSX.Element | null {
  const snapshot = useAppStore((s) => s.queueSnapshot);
  const total = useAppStore((s) => s.queueTotalSize);
  const [open, setOpen] = useState(false);

  if (total === 0) return null; // 空队列不占位

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] font-mono flex items-center gap-1 text-zinc-300 hover:text-zinc-100"
        title={`KodaX message queue: ${total} item${total !== 1 ? 's' : ''}`}
        aria-label="View message queue"
      >
        <span aria-hidden>⌛</span>
        <span>Queue {total}</span>
        <span className="text-zinc-500" aria-hidden>›</span>
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-full mb-2 w-96 max-h-80 overflow-auto bg-zinc-900 border border-zinc-800 rounded shadow-xl p-3 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="text-zinc-500 text-[10px] uppercase tracking-wider mb-2 flex justify-between">
            <span>KodaX Message Queue</span>
            <span>{total} total</span>
          </div>
          {snapshot.length === 0 ? (
            <div className="text-zinc-500 italic">
              {/* totalSize > 0 但 snapshot 空 — 说明 filter 后 main-thread 没有,subagent 有 */}
              Items in subagent queues; switch filter to view.
            </div>
          ) : (
            <ul className="space-y-2">
              {snapshot.map((m) => (
                <li key={m.id} className="border-b border-zinc-800 pb-2 last:border-b-0">
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className={PRIORITY_COLOR[m.priority]}>{m.priority}</span>
                    <span className="text-zinc-500">·</span>
                    <span className="text-zinc-400">{MODE_LABEL[m.mode]}</span>
                    {m.agentId !== undefined && (
                      <>
                        <span className="text-zinc-500">·</span>
                        <span className="text-zinc-400 font-mono truncate" title={m.agentId}>
                          {m.agentId.slice(0, 16)}
                        </span>
                      </>
                    )}
                    <span className="text-zinc-600 ml-auto">{formatTime(m.enqueuedAt)}</span>
                  </div>
                  <div className="mt-1 text-zinc-300 break-words" title={m.content}>
                    {m.content.length > 200 ? m.content.slice(0, 200) + '…' : m.content}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t border-zinc-800 pt-2 text-[10px] text-zinc-500 leading-relaxed">
            Read-only view. user-priority drains before background. Subagent task-notifications
            wait until parent agent peeks.
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
