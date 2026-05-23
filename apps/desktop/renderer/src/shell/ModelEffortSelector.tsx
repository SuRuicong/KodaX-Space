// ModelEffortSelector — F011-revised
//
// 截图参考（Claude Desktop 嵌 Claude Code）：右下角 `Opus 4.7 1M · Medium`，点击弹出：
//   ┌─────────────────────┐
//   │ Models    Ctrl+I    │
//   │   Opus 4.7 1M ✓     │
//   │                     │
//   │ Effort    Ctrl+E    │
//   │   Low               │
//   │   Medium ✓          │
//   │   High              │
//   │   Extra high        │
//   │   Max               │
//   └─────────────────────┘
//
// 对应到 KodaX：
//   - "Model" → 当前 session 的 provider + 其 default model（v0.1.x 可加 model picker）
//   - "Effort" → reasoning mode 重命名（off→Low/Med/High/Extra/Max 大致对齐 KodaXReasoningMode）
//
// alpha.1 阶段：Provider 切换走 session.setProvider；Effort 走 session.setReasoningMode（schema 仍是 off/auto/quick/balanced/deep，UI 显示成 Effort 文案）

import { useState } from 'react';
import { useAppStore } from '../store/appStore.js';

const EFFORT_LABEL: Record<string, string> = {
  off: 'Low',
  quick: 'Medium',
  balanced: 'High',
  auto: 'Extra high',
  deep: 'Max',
};
const EFFORT_ORDER = ['off', 'quick', 'balanced', 'auto', 'deep'] as const;

export function ModelEffortSelector(): JSX.Element | null {
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const providers = useAppStore((s) => s.providers);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const session = sessions.find((x) => x.sessionId === currentSessionId);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!session) {
    return <span className="text-zinc-400 font-mono">no session</span>;
  }

  const providerInfo = providers.find((p) => p.id === session.provider);
  const providerLabel = providerInfo?.displayName ?? session.provider;
  const effortLabel = EFFORT_LABEL[session.reasoningMode] ?? session.reasoningMode;

  async function setEffort(mode: string): Promise<void> {
    if (!window.kodaxSpace || busy || !session) return;
    setBusy(true);
    try {
      const r = await window.kodaxSpace.invoke('session.setReasoningMode', {
        sessionId: session.sessionId,
        mode: mode as 'off' | 'auto' | 'quick' | 'balanced' | 'deep',
      });
      if (r.ok) upsertSession({ ...session, reasoningMode: mode as typeof session.reasoningMode });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[10px] text-zinc-200 hover:text-zinc-100 flex items-center gap-1.5"
      >
        <span>{providerLabel}</span>
        <span className="text-zinc-500">·</span>
        <span>{effortLabel}</span>
        <span className="text-zinc-400 ml-0.5" aria-hidden>▿</span>
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-full mb-2 w-48 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-3 py-1 flex justify-between text-zinc-500 text-[10px] uppercase tracking-wider">
            <span>Effort</span>
            <span className="text-zinc-400">Ctrl+E</span>
          </div>
          {EFFORT_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => void setEffort(m)}
              className={`w-full text-left px-3 py-1 hover:bg-zinc-800 flex items-center gap-2 ${
                session.reasoningMode === m ? 'text-zinc-100' : 'text-zinc-400'
              }`}
            >
              <span>{EFFORT_LABEL[m]}</span>
              {session.reasoningMode === m && <span className="ml-auto text-emerald-500" aria-hidden>✓</span>}
            </button>
          ))}
          <div className="px-3 py-1 mt-1 border-t border-zinc-800 text-zinc-400 text-[10px]">
            Model picker — v0.1.x
          </div>
        </div>
      )}
    </div>
  );
}
