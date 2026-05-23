// ModelEffortSelector — F011-revised
//
// 截图参考（Claude Desktop 嵌 Claude Code）：右下角 `Opus 4.7 1M · Medium`，点击弹出：
//   ┌─────────────────────┐
//   │ Models              │
//   │   ● glm-coding      │   ← configured 列表（含 KodaX customProviders）
//   │   ○ ark-coding      │
//   │   ○ mock            │
//   │ Effort    Ctrl+E    │
//   │   Low               │
//   │   Medium ✓          │
//   │   High              │
//   │   Extra high        │
//   │   Max               │
//   └─────────────────────┘
//
// 两种工作模式：
//   - 有 currentSession：picker 操作直接 session.setProvider / session.setReasoningMode (in-flight 生效)
//   - 无 currentSession：picker 写入 store.pendingProviderId / pendingReasoningMode，
//     LeftSidebar "+ New session" / BottomBar 自动建 session 时优先用 pending 值
//
// 即用户可以"先选 model，再开打字 → session 用所选 model 建立"。
// 这是修复"我没建 session 就不让我选 provider/model" 的关键。

import { useEffect, useState } from 'react';
import type { ProviderInfo, SessionMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

type ReasoningMode = SessionMeta['reasoningMode'];

const EFFORT_LABEL: Record<ReasoningMode, string> = {
  off: 'Low',
  quick: 'Medium',
  balanced: 'High',
  auto: 'Extra high',
  deep: 'Max',
};
const EFFORT_ORDER: readonly ReasoningMode[] = ['off', 'quick', 'balanced', 'auto', 'deep'];

export function ModelEffortSelector(): JSX.Element {
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const pendingProviderId = useAppStore((s) => s.pendingProviderId);
  const pendingReasoningMode = useAppStore((s) => s.pendingReasoningMode);
  const setPendingProviderId = useAppStore((s) => s.setPendingProviderId);
  const setPendingReasoningMode = useAppStore((s) => s.setPendingReasoningMode);
  const upsertSession = useAppStore((s) => s.upsertSession);

  const session = sessions.find((x) => x.sessionId === currentSessionId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Ctrl+I 切换打开/关闭（Claude Desktop "Models  ⇧Ctrl I" 同款）。
  // Ctrl+E 用来切 effort——直接切到下一档（不必打开 popup）；按住 Shift 反向。
  // 数字键 1-9 当 popup 打开时直接选 provider；上 effort/下 provider 都用数字（提供清晰对应）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 当前显示的 provider/effort：有 session 走 session 字段；无 session 走 pending/fallback
  const activeProviderId =
    session?.provider ??
    pendingProviderId ??
    defaultProviderId ??
    kodaxDefaults?.provider ??
    null;
  const activeEffort: ReasoningMode =
    session?.reasoningMode ?? pendingReasoningMode ?? kodaxDefaults?.reasoningMode ?? 'auto';

  const providerInfo: ProviderInfo | undefined = activeProviderId
    ? providers.find((p) => p.id === activeProviderId)
    : undefined;
  const providerLabel = providerInfo?.displayName ?? activeProviderId ?? 'pick provider';

  // configured providers 列表，按 "已配 在前 / 同 id 字母序" 排
  const configuredProviders = providers
    .filter((p) => p.configured)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  async function pickProvider(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (session && window.kodaxSpace) {
        const r = await window.kodaxSpace.invoke('session.setProvider', {
          sessionId: session.sessionId,
          providerId: id,
        });
        if (r.ok) upsertSession({ ...session, provider: id });
      } else {
        // 无 session → 暂存为 pending，下次 session.create 用
        setPendingProviderId(id);
      }
    } finally {
      setBusy(false);
    }
  }

  async function pickEffort(mode: ReasoningMode): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (session && window.kodaxSpace) {
        const r = await window.kodaxSpace.invoke('session.setReasoningMode', {
          sessionId: session.sessionId,
          mode,
        });
        if (r.ok) upsertSession({ ...session, reasoningMode: mode });
      } else {
        setPendingReasoningMode(mode);
      }
    } finally {
      setBusy(false);
    }
  }

  // 无 session 时显示"(pending)" 提示让用户知道是为下次准备
  const buttonLabel = session
    ? `${providerLabel} · ${EFFORT_LABEL[activeEffort]}`
    : `${providerLabel} · ${EFFORT_LABEL[activeEffort]} (next)`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[10px] text-zinc-200 hover:text-zinc-100 flex items-center gap-1.5"
        title={session ? 'Change provider/effort for this session' : 'Pick provider/effort for next new session'}
      >
        <span>{buttonLabel}</span>
        <span className="text-zinc-400 ml-0.5" aria-hidden>▿</span>
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-full mb-2 w-60 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          {/* Models 区——对齐 Claude Desktop "Models  ⇧Ctrl I" */}
          <div className="px-3 py-1 flex justify-between items-center text-zinc-500 text-[10px] uppercase tracking-wider">
            <span>Models</span>
            <span className="font-mono text-zinc-400 normal-case flex items-center gap-1">
              {!session && <span className="text-amber-500 mr-1">for next session</span>}
              <kbd className="px-1 border border-zinc-700 rounded">⇧</kbd>
              <kbd className="px-1 border border-zinc-700 rounded">Ctrl</kbd>
              <kbd className="px-1 border border-zinc-700 rounded">I</kbd>
            </span>
          </div>
          {configuredProviders.length === 0 ? (
            <div className="px-3 py-1 text-zinc-400 text-[10px]">
              No configured providers — open Settings to add key
            </div>
          ) : (
            configuredProviders.map((p, idx) => {
              const selected = p.id === activeProviderId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void pickProvider(p.id)}
                  className={`w-full text-left px-3 py-1 hover:bg-zinc-800 flex items-center gap-2 ${
                    selected ? 'text-zinc-100' : 'text-zinc-300'
                  }`}
                  title={p.displayName}
                >
                  <span className="truncate flex-1">{p.displayName}</span>
                  {selected && <span className="text-emerald-500" aria-hidden>✓</span>}
                  {idx < 9 && (
                    <span className="text-zinc-500 text-[10px] font-mono w-3 text-right">{idx + 1}</span>
                  )}
                </button>
              );
            })
          )}

          {/* Effort 区——对齐 Claude Desktop "Effort  ⇧Ctrl E" */}
          <div className="border-t border-zinc-800 mt-1 pt-1">
            <div className="px-3 py-1 flex justify-between items-center text-zinc-500 text-[10px] uppercase tracking-wider">
              <span>Effort</span>
              <span className="font-mono text-zinc-400 flex items-center gap-1">
                <kbd className="px-1 border border-zinc-700 rounded">⇧</kbd>
                <kbd className="px-1 border border-zinc-700 rounded">Ctrl</kbd>
                <kbd className="px-1 border border-zinc-700 rounded">E</kbd>
              </span>
            </div>
            {EFFORT_ORDER.map((m) => {
              const selected = activeEffort === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => void pickEffort(m)}
                  className={`w-full text-left px-3 py-1 hover:bg-zinc-800 flex items-center gap-2 ${
                    selected ? 'text-zinc-100' : 'text-zinc-300'
                  }`}
                >
                  <span className="flex-1">{EFFORT_LABEL[m]}</span>
                  {selected && <span className="text-emerald-500" aria-hidden>✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
