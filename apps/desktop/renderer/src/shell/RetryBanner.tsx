// RetryBanner — Provider retry / recovery / rate-limit 实时提示 (v0.1.x)
//
// REPL StatusNoticesSurface 等价: KodaX SDK 在 provider 429 / overloaded / network error /
// guardrail circuit breaker 升级时会发 retry_after / provider_recovery events,但
// Space 之前没消费 → spinner 闷着转,用户不知道为什么慢。
//
// 显示规则:
//   - retry_after: 显示倒计时条 "Rate-limited by anthropic · retrying in 3.2s (attempt 2/5)"
//   - provider_recovery: 显示 "Provider falling back: ${recoveryAction} (attempt 1/3)"
//   - 1 个 banner; 同时来时 retry_after 优先 (它有具体 wait 时长)
//   - 倒计时归零 / 收到 iteration_start / session_complete → 自动消失
//
// 状态保鲜 (来自 events 流尾扫): 倒序找最近 retry_after,如果之后有 iteration_start 就不显示
// (KodaX 已经恢复正常 retry 后继续了)。

import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';

const EMPTY_EVENTS: readonly SessionEvent[] = [];

interface BannerState {
  readonly kind: 'retry' | 'recovery';
  readonly provider?: string;
  readonly reason?: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  /** retry: wallclock epoch ms when the retry will fire; recovery: 立即,无倒计时 */
  readonly retryAt?: number;
  /** recovery 路径: 走的 recovery action 名 (fallback-provider / sleep / etc) */
  readonly recoveryAction?: string;
}

function findActiveBanner(events: readonly SessionEvent[]): BannerState | null {
  // 倒序扫到最近一个 iteration_start / session_complete / session_error 边界 — 那之后的
  // retry/recovery 已经消化掉,不该显示。在边界之前如果有 retry_after / provider_recovery 就用最近一个。
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === 'iteration_start' || ev.kind === 'session_complete' || ev.kind === 'session_error') {
      // 之前没找到 retry/recovery → 没 banner
      return null;
    }
    if (ev.kind === 'retry_after') {
      const p = ev.payload;
      return {
        kind: 'retry',
        provider: p.provider,
        reason: p.reason,
        attempt: p.attempt,
        maxAttempts: p.maxAttempts,
        // SDK 不带 emit 时间戳; 用 now + waitMs (会比真实晚一点点,可接受)
        retryAt: Date.now() + p.waitMs,
      };
    }
    if (ev.kind === 'provider_recovery') {
      return {
        kind: 'recovery',
        recoveryAction: ev.recoveryAction,
        attempt: ev.attempt,
        maxAttempts: ev.maxAttempts,
      };
    }
  }
  return null;
}

export function RetryBanner(): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );
  const banner = findActiveBanner(events);

  // retry 路径: 1s 心跳让倒计时数字递减;到点后让 banner 自动消失 (实际由 iteration_start 触发,
  // 但 KodaX 重试速度有时比 1s tick 慢,UI 上让用户看到 "0s" 后默认折叠)。
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!banner || banner.kind !== 'retry' || !banner.retryAt) return undefined;
    const id = setInterval(() => forceTick((n) => (n + 1) % 1000), 500);
    return () => clearInterval(id);
  }, [banner?.kind, banner?.retryAt]);

  if (!banner) return null;

  // retry: 倒计时 + 描述
  if (banner.kind === 'retry') {
    const remainMs = banner.retryAt ? Math.max(0, banner.retryAt - Date.now()) : 0;
    const remainSec = (remainMs / 1000).toFixed(remainMs < 10_000 ? 1 : 0);
    const reasonLabel = banner.reason === 'rate-limit' ? 'Rate-limited' : 'Provider overloaded';
    return (
      <div
        className="px-3 py-1 text-[11px] flex items-center gap-2 text-amber-300/90 bg-amber-900/15 border-t border-b border-amber-900/30 font-mono"
        role="status"
        aria-live="polite"
      >
        <span aria-hidden>⏱</span>
        <span>
          {reasonLabel}{banner.provider ? ` by ${banner.provider}` : ''} · retrying in {remainSec}s
        </span>
        <span className="text-amber-300/60 ml-auto">
          attempt {banner.attempt}/{banner.maxAttempts}
        </span>
      </div>
    );
  }

  // recovery: 显示 recovery action + attempt
  return (
    <div
      className="px-3 py-1 text-[11px] flex items-center gap-2 text-sky-300/90 bg-sky-900/15 border-t border-b border-sky-900/30 font-mono"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden>↻</span>
      <span>Provider recovery: {banner.recoveryAction}</span>
      <span className="text-sky-300/60 ml-auto">
        attempt {banner.attempt}/{banner.maxAttempts}
      </span>
    </div>
  );
}
