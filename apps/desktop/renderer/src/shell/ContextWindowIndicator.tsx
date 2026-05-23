// ContextWindowIndicator — alpha.1
//
// Claude Desktop 截图 3：底部输入框右侧 `Context window  96.1k / 1.0M (10%) ›`
//
// 数据来源：session.event 里的 iteration_end.tokenCount + iteration_end.usage（如有）。
// alpha.1 阶段没接到真实 LLM tokens——Mock adapter emit iteration_end 时带 tokenCount，
// 这里取最新值作为"已用 token"。cap 默认 1M（Opus 4.7 1M 等长上下文 model；其他 model
// 不同 cap 可后续从 provider catalog 取）。

import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

// 默认 cap：1M tokens（Opus 4.7 1M / Sonnet 1M / Gemini 1M 等长 context 模型）。
// 后续从 provider catalog 的 model spec 拿真实 cap。
const DEFAULT_CONTEXT_CAP = 1_000_000;

// 稳定空数组，防 selector `?? []` literal 每次新引用触发 zustand re-render loop (React #185)。
const EMPTY_EVENTS: readonly SessionEvent[] = [];

export function ContextWindowIndicator(): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) => (currentSessionId ? s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS));

  if (!currentSessionId) return null;

  // 找最近一条 iteration_end 拿 tokenCount。alpha.1 阶段够用——后续可累加 usage
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

  // 颜色：< 50% 灰；50-80% 黄；>= 80% 红
  const color = percent < 50 ? 'text-zinc-500' : percent < 80 ? 'text-amber-400' : 'text-red-400';

  return (
    <button
      type="button"
      className={`text-[10px] font-mono flex items-center gap-1.5 ${color} hover:text-zinc-200`}
      title="Context window — click for breakdown (v0.1.x)"
    >
      <span>Context window</span>
      <span>
        {tokenStr} / {capStr}
      </span>
      <span>({percent.toFixed(0)}%)</span>
      <span className="text-zinc-600" aria-hidden>›</span>
    </button>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
