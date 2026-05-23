// ActivitySpinner — alpha.1
//
// 流式响应中的活动指示器，挂在输入框上方。Claude Code 同款 Braille 帧循环（80ms / 帧）+
// 实时状态文案（"Thinking…" / "Reading file…" / "Running bash…"）+ 当前 iter / tokens。
//
// 数据源（不引 store action，直接 selector）：
//   - eventsBySession[currentSessionId] 末尾 lifecycle 事件 → streaming?
//   - 末尾 tool_call/iteration_end 等 → 当前在干什么 + iter / token 数
//
// 不流式时 return null，所以挂在 BottomBar 里零成本。

import { useEffect, useState } from 'react';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

const EMPTY_EVENTS: readonly SessionEvent[] = [];
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 80;

interface ActivitySnapshot {
  readonly streaming: boolean;
  readonly status: string;
  readonly iter?: { current: number; max: number };
  readonly tokens?: number;
}

function snapshotFromEvents(events: readonly SessionEvent[]): ActivitySnapshot {
  if (events.length === 0) {
    return { streaming: false, status: '' };
  }

  // 倒序扫到最近的 lifecycle 事件，确定 streaming
  let streaming = false;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === 'session_complete' || ev.kind === 'session_error') {
      streaming = false;
      break;
    }
    if (ev.kind === 'session_start') {
      streaming = true;
      break;
    }
  }
  if (!streaming) return { streaming: false, status: '' };

  // 从倒序的"内容"事件推断当前在干什么 + 取最新 iter / tokens
  let status = 'Thinking…';
  let iter: { current: number; max: number } | undefined;
  let tokens: number | undefined;

  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    // 状态文案 — 只用最新一条匹配的（外层 break 前先抓 iter/tokens）
    if (status === 'Thinking…') {
      if (ev.kind === 'tool_start' || ev.kind === 'tool_input_delta' || ev.kind === 'tool_progress') {
        const name = (ev as { toolName?: string }).toolName ?? 'tool';
        status = `Running ${name}…`;
      } else if (ev.kind === 'tool_result') {
        status = 'Processing result…';
      } else if (ev.kind === 'thinking_delta' || ev.kind === 'thinking_end') {
        status = 'Thinking…';
      } else if (ev.kind === 'text_delta') {
        status = 'Writing…';
      } else if (ev.kind === 'compact_start' || ev.kind === 'compact_stats' || ev.kind === 'compact_end') {
        status = 'Compacting context…';
      }
    }
    if (!iter && ev.kind === 'iteration_end') {
      iter = { current: ev.iter, max: ev.maxIter };
      tokens = ev.tokenCount;
    } else if (!iter && ev.kind === 'iteration_start') {
      iter = { current: ev.iter, max: ev.maxIter };
    }
    if (iter && status !== 'Thinking…') break; // 都抓到就提前出
  }

  return { streaming: true, status, iter, tokens };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function ActivitySpinner(): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );

  const snap = snapshotFromEvents(events);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!snap.streaming) return undefined;
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), FRAME_MS);
    return () => clearInterval(id);
  }, [snap.streaming]);

  if (!snap.streaming) return null;

  const iterStr = snap.iter ? `iter ${snap.iter.current}/${snap.iter.max}` : '';
  const tokenStr = snap.tokens !== undefined ? `${formatTokens(snap.tokens)} tokens` : '';
  const tail = [iterStr, tokenStr].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-mono px-1 py-0.5">
      <span className="text-amber-400 inline-block w-3 text-center" aria-hidden>
        {FRAMES[frame]}
      </span>
      <span className="text-zinc-300">{snap.status}</span>
      {tail && <span className="text-zinc-500">· {tail}</span>}
    </div>
  );
}

/** Hook 版给 BottomBar 的 Send/Stop 按钮用 — 只关心 streaming bool. */
export function useIsStreaming(): boolean {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );
  return snapshotFromEvents(events).streaming;
}
