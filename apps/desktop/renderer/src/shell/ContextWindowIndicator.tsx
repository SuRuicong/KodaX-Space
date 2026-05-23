// ContextWindowIndicator — alpha.1
//
// Claude Desktop 截图 9：底部输入框右侧 `Context window  96.1k / 1.0M (10%) ›`，
// 点击 › 展开 breakdown 弹窗，含进度条 + 分项 token 占用。
//
// 数据来源：iteration_end 事件的 tokenCount（最近一条）。
// alpha.1 不分类 (system / context / messages / tools)，只显示总量；
// 后续接 KodaX SDK usage breakdown 后再分。

import { useState } from 'react';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

const DEFAULT_CONTEXT_CAP = 1_000_000;
const EMPTY_EVENTS: readonly SessionEvent[] = [];

export function ContextWindowIndicator(): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );
  const [open, setOpen] = useState(false);

  if (!currentSessionId) return null;

  let tokenCount = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === 'iteration_end') {
      tokenCount = ev.tokenCount;
      break;
    }
  }

  const cap = DEFAULT_CONTEXT_CAP;
  const percent = Math.min(100, (tokenCount / cap) * 100);
  const tokenStr = formatTokens(tokenCount);
  const capStr = formatTokens(cap);

  const color = percent < 50 ? 'text-zinc-300' : percent < 80 ? 'text-amber-400' : 'text-red-400';
  const barColor =
    percent < 50 ? 'bg-zinc-400' : percent < 80 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`text-[10px] font-mono flex items-center gap-1.5 ${color} hover:text-zinc-200`}
        title="Click for breakdown"
      >
        <span>Context window</span>
        <span>
          {tokenStr} / {capStr}
        </span>
        <span>({percent.toFixed(0)}%)</span>
        <span className="text-zinc-400" aria-hidden>›</span>
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-full mb-2 w-72 bg-zinc-900 border border-zinc-800 rounded shadow-xl p-3 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="text-zinc-500 text-[10px] uppercase tracking-wider mb-2">
            Context window
          </div>
          {/* 顶部数字 */}
          <div className="flex justify-between text-zinc-200 font-mono mb-1.5">
            <span>{tokenStr}</span>
            <span className="text-zinc-500">/ {capStr}</span>
          </div>
          {/* 进度条 */}
          <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
            <div
              className={`h-full ${barColor} transition-all`}
              style={{ width: `${percent}%` }}
            />
          </div>
          {/* 百分比 + 注释 */}
          <div className="mt-2 text-[10px] text-zinc-400 flex justify-between">
            <span>{percent.toFixed(1)}% used</span>
            <span>{formatTokens(cap - tokenCount)} left</span>
          </div>

          {/* alpha.1 breakdown 占位：等 KodaX SDK usage 出 segment 数据再分项 */}
          <div className="mt-3 border-t border-zinc-800 pt-2 text-[10px] text-zinc-500 leading-relaxed">
            Token breakdown by category — coming in v0.1.x
            <br />
            Cap default 1M; switches per-model when SDK reports.
          </div>
        </div>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
