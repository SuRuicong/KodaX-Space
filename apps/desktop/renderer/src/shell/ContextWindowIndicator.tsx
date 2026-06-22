// ContextWindowIndicator — alpha.2
//
// Claude Desktop 截图 9：底部输入框右侧 `Context window  96.1k / 200k (48%) ›`，
// 点击 › 展开 breakdown 弹窗，含进度条 + 分项 token 占用。
//
// 数据来源：
//   - tokenCount: iteration_end 事件的 tokenCount（最近一条）
//   - cap: 走 SDK driven IPC `provider.modelContextWindow`，按 (providerId, model) 缓存
//     —— SDK 内部 resolveContextWindow 四步级联（user override → provider per-model →
//     provider default → 200k hard fallback），UI 用同一函数 = single source of truth
//   - 历史 fallback: 查询期间 / IPC 失败时仍用 modelContextCaps 硬编码表兜底，避免空窗显示

import { useEffect, useState } from 'react';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { Caret } from '../components/Caret.js';
import { useAppStore, type UserMessage } from '../store/appStore.js';
import { getModelContextCap } from './modelContextCaps.js';
import { resolveActiveModel } from './resolveActiveModel.js';

const EMPTY_EVENTS: readonly SessionEvent[] = [];
const EMPTY_USER_MESSAGES: readonly UserMessage[] = [];

/**
 * 粗略 token 估算——历史 session restore 后没有 iteration_end 事件，
 * 否则 context window 一直显示 0/cap (0%)。同 bubbles.tsx#approxTokens 同公式。
 *   - ASCII: 4 chars / 1 token
 *   - non-ASCII (CJK / emoji): 1 token / char
 */
function approxTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else nonAscii++;
  }
  return Math.max(0, Math.round(ascii / 4 + nonAscii));
}

// 模块级 cache —— per (providerId, model) 唯一 contextWindow，跨 session 共享，
// 切 model 时不会重新查 IPC（除非缓存里没有）。值为 null 代表"正在查询中"，避免并发重复请求。
const contextWindowCache = new Map<string, number | null>();
function cacheKey(providerId: string, model: string): string {
  return `${providerId}|${model}`;
}

/** 后台查 SDK 拿 contextWindow + cache; UI 同步 fallback 到硬编码表先渲染避免抖动。*/
function useResolvedContextWindow(
  providerId: string | null,
  model: string | null,
  hardcodedFallback: number,
): number {
  const [resolved, setResolved] = useState<number | null>(
    providerId && model ? (contextWindowCache.get(cacheKey(providerId, model)) ?? null) : null,
  );

  useEffect(() => {
    if (!providerId || !model) {
      setResolved(null);
      return;
    }
    const key = cacheKey(providerId, model);
    const cached = contextWindowCache.get(key);
    // cached === number → 已查过，setState 同步把值刷新到本组件
    if (typeof cached === 'number') {
      setResolved(cached);
      return;
    }
    // cached === null → 正在查；订阅一次性 setState（其他实例会一起更新）。
    // 这里简化：每个组件都查一次，IPC 端处理重复请求成本 50ms 以内可忽略。
    if (cached === null) {
      setResolved(null);
      return;
    }
    setResolved(null);
    contextWindowCache.set(key, null); // pending sentinel
    let cancelled = false;
    // window.kodaxSpace 在 preload 注入；prod 永远 defined，但 type 上是 optional
    const api = window.kodaxSpace;
    if (!api) {
      setResolved(hardcodedFallback);
      contextWindowCache.set(key, hardcodedFallback);
      return;
    }
    void api
      .invoke('provider.modelContextWindow', { providerId, model })
      .then((r) => {
        if (cancelled) return;
        // source === 'fallback' 表示 SDK 没真正拿到 provider-advertised window
        // (常见原因：该 provider 没配 API key,resolveProvider 直接 throw)。
        // 此时不要信 SDK 给的 200k——回退到 renderer 端 hardcoded table，因为它至少
        // 有按 model 名前缀的真实信息 (gpt-5 → 1M、deepseek-v3.2 → 1M).
        let value: number;
        if (!r.ok) {
          value = hardcodedFallback;
        } else if (r.data.source === 'fallback') {
          value = hardcodedFallback;
        } else {
          value = r.data.contextWindow > 0 ? r.data.contextWindow : hardcodedFallback;
        }
        contextWindowCache.set(key, value);
        setResolved(value);
      })
      .catch(() => {
        if (cancelled) return;
        // 失败时记 hardcoded fallback 进 cache，避免每次 render 都重试
        contextWindowCache.set(key, hardcodedFallback);
        setResolved(hardcodedFallback);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, model, hardcodedFallback]);

  return resolved ?? hardcodedFallback;
}

export function ContextWindowIndicator(): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? (s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS) : EMPTY_EVENTS,
  );
  const userMessages = useAppStore((s) =>
    currentSessionId
      ? (s.userMessagesBySession[currentSessionId] ?? EMPTY_USER_MESSAGES)
      : EMPTY_USER_MESSAGES,
  );
  // 当前 active model — session 优先；无 session 时用 pendingModel / kodaxDefaults / provider 默认
  const sessions = useAppStore((s) => s.sessions);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const pendingProviderId = useAppStore((s) => s.pendingProviderId);
  const pendingModel = useAppStore((s) => s.pendingModel);
  const [open, setOpen] = useState(false);

  // Active provider / model 必须在 early-return 之前算好，让下面的 useResolvedContextWindow
  // 永远以稳定顺序被 React 调用。即便 currentSessionId 为 null，hook 也调一次（输入 null →
  // 返回 hardcodedFallback，没有副作用）。
  const session = currentSessionId
    ? sessions.find((s) => s.sessionId === currentSessionId)
    : undefined;
  const activeProviderId =
    session?.provider ?? pendingProviderId ?? defaultProviderId ?? kodaxDefaults?.provider ?? null;
  const activeProvider = activeProviderId
    ? providers.find((p) => p.id === activeProviderId)
    : undefined;
  const preferredModel = resolveActiveModel({
    activeProviderId,
    activeProviderModels: activeProvider?.models,
    activeProviderDefaultModel: activeProvider?.defaultModel,
    pendingModel,
    kodaxDefaultsProvider: kodaxDefaults?.provider,
    kodaxDefaultsModel: kodaxDefaults?.model,
  });
  const activeModel = session
    ? (session.model ?? activeProvider?.defaultModel ?? null)
    : (preferredModel !== '—' ? preferredModel : null);
  const hardcodedCap = getModelContextCap(activeModel);
  const cap = useResolvedContextWindow(activeProviderId, activeModel, hardcodedCap);

  if (!currentSessionId) return null;

  let tokenCount = 0;
  let isEstimate = false;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === 'iteration_end') {
      tokenCount = ev.tokenCount;
      break;
    }
  }
  // Fallback: history restore 后没有 iteration_end → 自己估算累计 token。
  // 累加 user 消息 + assistant text/thinking + tool result（占 LLM 上下文的全部 string 内容）。
  if (tokenCount === 0 && (events.length > 0 || userMessages.length > 0)) {
    let total = 0;
    for (const um of userMessages) total += approxTokens(um.content);
    for (const ev of events) {
      if (ev.kind === 'text_delta' || ev.kind === 'thinking_delta') {
        total += approxTokens(ev.text);
      } else if (ev.kind === 'tool_result') {
        total += approxTokens(ev.content);
      } else if (ev.kind === 'thinking_end') {
        // thinking_end 携带完整 thinking text；若之前已经累加过 thinking_delta 会双算——
        // 但 history restore 的 emit 只走 thinking_delta，session 实时跑也通常 delta 给完了
        // 才 end。保守不重复加。
      }
    }
    tokenCount = total;
    isEstimate = true;
  }
  const percent = Math.min(100, (tokenCount / cap) * 100);
  // 历史恢复时是 estimate（无 iteration_end）— 加 "~" 前缀让用户知道是近似
  const tokenStr = `${isEstimate ? '~' : ''}${formatTokens(tokenCount)}`;
  const capStr = formatTokens(cap);

  const color = percent < 50 ? 'text-fg-secondary' : percent < 80 ? 'text-warn' : 'text-danger';
  const barColor = percent < 50 ? 'bg-fg-faint' : percent < 80 ? 'bg-warn' : 'bg-danger';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`text-[11px] font-mono flex items-center gap-1.5 ${color} hover:text-fg-primary`}
        title="Click for breakdown"
      >
        <span>Context window</span>
        <span>
          {tokenStr} / {capStr}
        </span>
        <span>({percent.toFixed(0)}%)</span>
        <Caret open={false} className="text-fg-muted" />
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-full mb-2 w-72 bg-surface-4 border border-border-default rounded-lg shadow-xl p-3 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="text-fg-muted text-[11px] uppercase tracking-wider mb-2">
            Context window
          </div>
          {/* 顶部数字 */}
          <div className="flex justify-between text-fg-primary font-mono mb-1.5">
            <span>{tokenStr}</span>
            <span className="text-fg-muted">/ {capStr}</span>
          </div>
          {/* 进度条 */}
          <div className="h-1.5 bg-surface-3 rounded overflow-hidden">
            <div className={`h-full ${barColor} transition-all`} style={{ width: `${percent}%` }} />
          </div>
          {/* 百分比 + 注释 */}
          <div className="mt-2 text-[11px] text-fg-muted flex justify-between">
            <span>{percent.toFixed(1)}% used</span>
            <span>{formatTokens(cap - tokenCount)} left</span>
          </div>

          {/* alpha.1 breakdown 占位：等 KodaX SDK usage 出 segment 数据再分项 */}
          <div className="mt-3 border-t border-border-default pt-2 text-[11px] text-fg-muted leading-relaxed">
            Token breakdown by category — coming in v0.1.x
            <br />
            Cap follows current model{activeModel ? ` (${activeModel})` : ''}; updates when you
            switch.
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
