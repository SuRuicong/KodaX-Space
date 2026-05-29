// ActivitySpinner — alpha.1 / P0 polish
//
// 流式响应中的活动指示器，挂在输入框上方。Braille 帧循环（80ms / 帧）+
// 实时状态文案（"Thinking…" / "Reading file…" / "Running bash…"）+ 当前 iter / tokens +
// 已用秒数（spinner stats tail，对齐 KodaX TUI）。
//
// 数据源：
//   - pendingSendBySession[currentSessionId] → session_start 还没到的等待期也亮 spinner
//   - eventsBySession[currentSessionId] 末尾 lifecycle 事件 → streaming?
//   - 末尾 tool_call/iteration_end 等 → 当前在干什么 + iter / token 数
//
// 不 streaming 且不 pending 时 return null，所以挂在 BottomBar 里零成本。

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
  /** session_start 的时间戳（spinner 计算 elapsed s 用）；pending 时退回 null。 */
  readonly startedAt: number | null;
  /** 当前 tool 正在操作的 path（write/edit/read 等 toolInput 含 path/file_path）— 渲染时显示 basename。*/
  readonly toolPath?: string;
  /** Thinking…/Writing… 状态时的累积 char count (倒扫到上个非 thinking_delta 边界)。 */
  readonly thinkingChars?: number;
  /** Running tool… 状态时当前 toolId 累积 tool_input_delta partialJson char count。 */
  readonly toolInputChars?: number;
}

function snapshotFromEvents(
  events: readonly SessionEvent[],
  pending: boolean,
  managedPhase: string | undefined,
): ActivitySnapshot {
  if (events.length === 0) {
    // pending 但还没事件 → 显示 "Sending…" 占位，让 spinner 在 invoke 瞬间就亮
    return pending
      ? { streaming: true, status: 'Sending…', startedAt: Date.now() }
      : { streaming: false, status: '', startedAt: null };
  }

  // 倒序扫到最近的 lifecycle 事件，确定 streaming
  let streaming = false;
  let startedAt: number | null = null;
  // session_start 不带时间戳；用 events 数组在 store 里追加顺序近似——精确不可用时用
  // Date.now() 作为下限（只影响 elapsed s 显示，业务无依赖）。
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
  if (!streaming) {
    // session_start 没在末尾找到 → 如果还在 pending（新 send 还没回事件）也保持亮
    if (pending) return { streaming: true, status: 'Sending…', startedAt: Date.now() };
    return { streaming: false, status: '', startedAt: null };
  }
  // streaming 中：取最新 session_start 索引近似 startedAt。store 不存时间戳，
  // 这里只做"第一次见到 session_start 时记一次"——用模块级 WeakMap 缓存（session 切换重置）。
  // 简化：用 events.length 比较，第一次为新流时 reset
  startedAt = resolveStartedAtMemo(events);

  // 从倒序的"内容"事件推断当前在干什么 + 取最新 iter / tokens
  let status = 'Thinking…';
  let iter: { current: number; max: number } | undefined;
  let tokens: number | undefined;
  let activeToolId: string | undefined;

  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    // 状态文案 — 只用最新一条匹配的（外层 break 前先抓 iter/tokens）
    if (status === 'Thinking…') {
      if (ev.kind === 'tool_start' || ev.kind === 'tool_input_delta' || ev.kind === 'tool_progress') {
        const name = (ev as { toolName?: string }).toolName ?? 'tool';
        status = `Running ${name}…`;
        activeToolId = (ev as { toolId?: string }).toolId;
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

  // 找当前 activeTool 的 path：tool_input_delta 是 partial JSON，没法可靠抽 path；
  // 倒扫匹配 toolId 的 tool_start (input 已包含 path/file_path)。
  let toolPath: string | undefined;
  if (activeToolId) {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.kind === 'tool_start' && (ev as { toolId?: string }).toolId === activeToolId) {
        const input = (ev as { input?: Record<string, unknown> }).input;
        const raw = input?.path ?? input?.file_path;
        if (typeof raw === 'string' && raw.length > 0 && raw.length < 256) toolPath = raw;
        break;
      }
    }
  }

  // 字符数实时计数 (REPL StatusBar 同款)。让用户看到 LLM 实际在产出多少字符,而不只是"...转圈"。
  //   - thinking: 累计最近一段连续的 thinking_delta (从最后一个非 thinking 事件起,排除 thinking_end)
  //   - tool_input: 累计当前 activeToolId 的所有 tool_input_delta partialJson 长度
  // 都从尾巴扫,边界是: session_start / iteration_end / tool_result / text_delta 等"打断"事件。
  let thinkingChars: number | undefined;
  if (status === 'Thinking…' || status === 'Writing…') {
    let total = 0;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.kind === 'thinking_delta') {
        total += ev.text.length;
      } else if (ev.kind === 'thinking_end') {
        // thinking_end 携带完整 thinking text;比逐条 delta 更权威,优先用
        total = ev.thinking.length;
        break;
      } else if (ev.kind === 'text_delta' || ev.kind === 'tool_start' || ev.kind === 'tool_result'
              || ev.kind === 'iteration_end' || ev.kind === 'session_start' || ev.kind === 'session_complete') {
        break;
      }
    }
    if (total > 0) thinkingChars = total;
  }

  let toolInputChars: number | undefined;
  if (activeToolId) {
    let total = 0;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.kind === 'tool_input_delta' && (ev as { toolId?: string }).toolId === activeToolId) {
        total += ev.partialJson.length;
      } else if (ev.kind === 'tool_start' && (ev as { toolId?: string }).toolId === activeToolId) {
        break;
      } else if (ev.kind === 'tool_result' || ev.kind === 'iteration_end') {
        break;
      }
    }
    if (total > 0) toolInputChars = total;
  }

  // FEATURE_184/F193 — Sidecar Verifier 在 Worker 文字结束后再跑一次 LLM 评判
  // (~3-10s 尾延迟)。SDK 通过 onManagedTaskStatus 发 phase='verifying'，验证结束
  // 后转回 phase='worker'。覆盖 status，避免 spinner 卡在 "Writing…" 看着像没反应。
  if (managedPhase === 'verifying') {
    status = 'Verifying…';
    toolPath = undefined;
    thinkingChars = undefined;
    toolInputChars = undefined;
  }

  return { streaming: true, status, iter, tokens, startedAt, toolPath, thinkingChars, toolInputChars };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// 每个 session 第一次进入 streaming 时记 startedAt；session_complete/error 时清。
// 用 WeakMap key 不行（events 数组每次新引用），用 events.length=1 的"首次见到 session_start"
// 做指纹粗略 memo 一下；不准也没关系，仅 spinner elapsed 展示用。
const startedAtCache = new Map<number, number>(); // key: events ref-identity proxy (first ev sessionId hash?)
function resolveStartedAtMemo(events: readonly SessionEvent[]): number {
  // 找最近一段 streaming 的 session_start 索引；该索引同 events.length 一起作为 key
  let lastStartIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const k = events[i].kind;
    if (k === 'session_complete' || k === 'session_error') break;
    if (k === 'session_start') {
      lastStartIdx = i;
      break;
    }
  }
  if (lastStartIdx < 0) return Date.now();
  // key = lastStartIdx + length 后缀简化指纹（不同 streaming run 必不同 key 段）
  const key = lastStartIdx * 1_000_003 + events.length;
  const cached = startedAtCache.get(key);
  if (cached !== undefined) return cached;
  const now = Date.now();
  startedAtCache.set(key, now);
  // 限制 cache 大小防内存涨
  if (startedAtCache.size > 64) {
    const firstKey = startedAtCache.keys().next().value;
    if (firstKey !== undefined) startedAtCache.delete(firstKey);
  }
  return now;
}

export function ActivitySpinner(): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );
  const pending = useAppStore((s) =>
    currentSessionId ? Boolean(s.pendingSendBySession[currentSessionId]) : false,
  );
  const managedPhase = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId]?.phase : undefined,
  );

  const snap = snapshotFromEvents(events, pending, managedPhase);
  const [frame, setFrame] = useState(0);
  // elapsed 用 1s 心跳，独立于 80ms spinner 帧，避免重复 setState
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!snap.streaming) return undefined;
    const spinId = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), FRAME_MS);
    const elapsedId = setInterval(() => forceTick((n) => (n + 1) % 1000), 1_000);
    return () => {
      clearInterval(spinId);
      clearInterval(elapsedId);
    };
  }, [snap.streaming]);

  if (!snap.streaming) return null;

  const elapsedSec = snap.startedAt !== null
    ? Math.max(0, Math.round((Date.now() - snap.startedAt) / 1000))
    : 0;
  const elapsedStr = elapsedSec > 0 ? `${elapsedSec}s` : '';

  const iterStr = snap.iter ? `iter ${snap.iter.current}/${snap.iter.max}` : '';

  // tokens 后跟 tok/s rate — 用 cumulative tokens / elapsed sec 作平均速率（足以反映进度感）
  let tokenStr = '';
  if (snap.tokens !== undefined) {
    tokenStr = `${formatTokens(snap.tokens)} tokens`;
    if (elapsedSec >= 2) {
      const rate = Math.round(snap.tokens / elapsedSec);
      if (rate > 0) tokenStr += ` (${formatTokens(rate)}/s)`;
    }
  }

  // Sending 阶段 > 2s 时补 "waiting for LLM"，让长 TTFB 不像卡死
  const sendingTooLong = snap.status === 'Sending…' && elapsedSec >= 2;
  const statusBase = sendingTooLong ? 'Sending… · waiting for LLM' : snap.status;

  // tool path 显示 basename — 全路径太长，basename + dim 灰显
  const toolBase = snap.toolPath ? snap.toolPath.split(/[\\/]/).filter(Boolean).pop() : null;

  // Char counts: REPL StatusBar 同款 — thinking 中显示 "3.4k chars"; 工具 input partial JSON
  // 累积时显示 "2.1k chars"。让用户看到 LLM 实际产出量，而不只是"...转圈"。
  let charStr = '';
  if (snap.thinkingChars !== undefined) {
    charStr = `${formatTokens(snap.thinkingChars)} chars`;
  } else if (snap.toolInputChars !== undefined) {
    charStr = `${formatTokens(snap.toolInputChars)} chars`;
  }

  const tail = [elapsedStr, iterStr, tokenStr, charStr].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-mono px-1 py-0.5">
      <span className="text-amber-400 inline-block w-3 text-center" aria-hidden>
        {FRAMES[frame]}
      </span>
      <span className="text-zinc-300">{statusBase}</span>
      {toolBase && (
        <span className="text-zinc-500 truncate max-w-[280px]" title={snap.toolPath ?? undefined}>
          {toolBase}
        </span>
      )}
      {tail && <span className="text-zinc-500">· {tail}</span>}
    </div>
  );
}

/** Hook 版给 BottomBar 的 Send/Stop 按钮用 — 只关心 streaming bool（含 pendingSend）. */
export function useIsStreaming(): boolean {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );
  const pending = useAppStore((s) =>
    currentSessionId ? Boolean(s.pendingSendBySession[currentSessionId]) : false,
  );
  const managedPhase = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId]?.phase : undefined,
  );
  return snapshotFromEvents(events, pending, managedPhase).streaming;
}
