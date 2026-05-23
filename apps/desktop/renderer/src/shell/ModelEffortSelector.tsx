// ModelEffortSelector — alpha.2
//
// 右下角 chip → 弹出 "二级" picker。布局采用 2 列同框（用户讨论决定的方案 A —
// 比 hover 子菜单不易误关、信息一眼全收）：
//
//   ┌────────────────────────────────────────┐
//   │ PROVIDER          │ MODEL              │
//   │   Zhipu Coding ✓  │   glm-5            │
//   │   Anthropic       │   glm-5.1     ✓    │
//   │   Volcengine Ark  │   glm-5-turbo      │
//   │   ...             │                    │
//   ├────────────────────────────────────────┤
//   │ EFFORT  ⇧Ctrl E                        │
//   │   Low / Medium ✓ / High / Extra / Max  │
//   └────────────────────────────────────────┘
//
// 点 provider → 右列即时刷新成那个 provider 的 models 列表（无需 hover）。
// 点 model → 一次性把 provider + model 都 commit 给 store / session。
// model 应用方式：
//   - 有 session：session.setProvider 切 provider；model 通过 /model <name> slash 命令 fire-and-forget
//     （main 端已有 slash registry; KodaX REPL 的 /model 标准做法）
//   - 无 session：pendingProviderId + pendingModel 暂存；下次 ensureSession 时一起设
//
// Ctrl+I 切换打开；底部 effort 块保持以前用法。

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
  const pendingModel = useAppStore((s) => s.pendingModel);
  const setPendingProviderId = useAppStore((s) => s.setPendingProviderId);
  const setPendingReasoningMode = useAppStore((s) => s.setPendingReasoningMode);
  const setPendingModel = useAppStore((s) => s.setPendingModel);
  const upsertSession = useAppStore((s) => s.upsertSession);

  const session = sessions.find((x) => x.sessionId === currentSessionId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // 右列展示哪个 provider 的 models — 默认跟随 active provider；
  // 用户在左列点别的 provider 时只改这个，不立即 commit (等点 model 才 commit)。
  const [previewProviderId, setPreviewProviderId] = useState<string | null>(null);

  // Ctrl+I 打开/关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.ctrlKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 当前 active provider/model/effort（用 session > pending > defaults）
  const activeProviderId =
    session?.provider ??
    pendingProviderId ??
    defaultProviderId ??
    kodaxDefaults?.provider ??
    null;
  const activeProvider: ProviderInfo | undefined = activeProviderId
    ? providers.find((p) => p.id === activeProviderId)
    : undefined;
  const activeModel: string =
    pendingModel ??
    kodaxDefaults?.model ??
    activeProvider?.defaultModel ??
    '—';
  const activeEffort: ReasoningMode =
    session?.reasoningMode ?? pendingReasoningMode ?? kodaxDefaults?.reasoningMode ?? 'auto';

  // 右列正在预览的 provider — 打开时初始化为 active；用户左列点别的就更新 preview
  const previewProvider = providers.find(
    (p) => p.id === (previewProviderId ?? activeProviderId),
  );
  const previewModels = previewProvider?.models ?? (previewProvider?.defaultModel ? [previewProvider.defaultModel] : []);

  const configuredProviders = providers
    .filter((p) => p.configured)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  async function commitProviderAndModel(providerId: string, model: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (session && window.kodaxSpace) {
        // 切 provider
        if (providerId !== session.provider) {
          const r = await window.kodaxSpace.invoke('session.setProvider', {
            sessionId: session.sessionId,
            providerId,
          });
          if (r.ok) upsertSession({ ...session, provider: providerId });
        }
        // 切 model — 通过 /model slash 命令 (KodaX REPL 内置)
        if (model !== activeModel) {
          await window.kodaxSpace.invoke('slash.exec', {
            sessionId: session.sessionId,
            name: 'model',
            args: [model],
          }).catch(() => {});
          setPendingModel(model);
        }
      } else {
        setPendingProviderId(providerId);
        setPendingModel(model);
      }
    } finally {
      setBusy(false);
      setOpen(false);
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

  // P3: Ctrl+T 循环 reasoning depth — 对齐 KodaX TUI。off→quick→balanced→auto→deep→off。
  // 不与 Ctrl+Shift+T (theme) 冲突 (shift 不同)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        const idx = EFFORT_ORDER.indexOf(activeEffort);
        const next = EFFORT_ORDER[(idx + 1) % EFFORT_ORDER.length];
        void pickEffort(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEffort, session, busy]);

  // Button label: "<provider> · <model> · <effort>"
  const providerLabel = activeProvider?.displayName ?? activeProviderId ?? 'pick provider';
  const baseLabel = `${providerLabel} · ${activeModel} · ${EFFORT_LABEL[activeEffort]}`;
  const buttonLabel = session ? baseLabel : `${baseLabel} (next)`;

  // 打开时把 preview 重置到 active provider
  function openPicker(): void {
    if (!open) {
      setPreviewProviderId(activeProviderId);
    }
    setOpen((v) => !v);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPicker}
        className="font-mono text-[10px] text-zinc-200 hover:text-zinc-100 flex items-center gap-1.5"
        title={session ? 'Change provider/model/effort' : 'Pick provider/model/effort for next session'}
      >
        <span className="truncate max-w-[280px]">{buttonLabel}</span>
        <span className="text-zinc-400 ml-0.5" aria-hidden>▿</span>
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-full mb-2 w-[460px] bg-zinc-900 border border-zinc-800 rounded shadow-xl text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          {/* 2 列：Provider | Model */}
          <div className="grid grid-cols-2 gap-0">
            <div className="border-r border-zinc-800">
              <div className="px-3 py-1 flex justify-between items-center text-zinc-500 text-[10px] uppercase tracking-wider">
                <span>Provider</span>
                <span className="font-mono text-zinc-400 flex items-center gap-1">
                  <kbd className="px-1 border border-zinc-700 rounded">Ctrl</kbd>
                  <kbd className="px-1 border border-zinc-700 rounded">I</kbd>
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {configuredProviders.length === 0 ? (
                  <div className="px-3 py-1 text-zinc-400 text-[10px]">
                    No configured providers — open Settings to add key
                  </div>
                ) : (
                  configuredProviders.map((p, idx) => {
                    const isPreviewing = (previewProviderId ?? activeProviderId) === p.id;
                    const isActive = activeProviderId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPreviewProviderId(p.id)}
                        className={`w-full text-left px-3 py-1 hover:bg-zinc-800 flex items-center gap-2 ${
                          isPreviewing ? 'bg-zinc-800/60 text-zinc-100' : 'text-zinc-300'
                        }`}
                        title={p.displayName}
                      >
                        <span className="truncate flex-1">{p.displayName}</span>
                        {isActive && <span className="text-emerald-500" aria-hidden>✓</span>}
                        {idx < 9 && (
                          <span className="text-zinc-500 text-[10px] font-mono w-3 text-right">{idx + 1}</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <div className="px-3 py-1 flex justify-between items-center text-zinc-500 text-[10px] uppercase tracking-wider">
                <span>Model</span>
                {!session && <span className="text-amber-500 normal-case">for next session</span>}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {previewModels.length === 0 ? (
                  <div className="px-3 py-1 text-zinc-400 text-[10px]">No models</div>
                ) : (
                  previewModels.map((m) => {
                    const isActive = activeProviderId === previewProvider?.id && activeModel === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => void commitProviderAndModel(previewProvider?.id ?? '', m)}
                        disabled={!previewProvider}
                        className={`w-full text-left px-3 py-1 hover:bg-zinc-800 flex items-center gap-2 ${
                          isActive ? 'text-zinc-100' : 'text-zinc-300'
                        }`}
                      >
                        <span className="truncate flex-1 font-mono">{m}</span>
                        {isActive && <span className="text-emerald-500" aria-hidden>✓</span>}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Effort 行（横跨 2 列底部） */}
          <div className="border-t border-zinc-800 pt-1">
            <div className="px-3 py-1 flex justify-between items-center text-zinc-500 text-[10px] uppercase tracking-wider">
              <span>Effort</span>
              <span className="font-mono text-zinc-400 flex items-center gap-1">
                <kbd className="px-1 border border-zinc-700 rounded">⇧</kbd>
                <kbd className="px-1 border border-zinc-700 rounded">Ctrl</kbd>
                <kbd className="px-1 border border-zinc-700 rounded">E</kbd>
              </span>
            </div>
            <div className="grid grid-cols-5 px-2 pb-1 gap-1">
              {EFFORT_ORDER.map((m) => {
                const selected = activeEffort === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => void pickEffort(m)}
                    className={`text-center px-1 py-1 rounded hover:bg-zinc-800 ${
                      selected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300'
                    }`}
                  >
                    {EFFORT_LABEL[m]}
                    {selected && <span className="ml-0.5 text-emerald-500" aria-hidden>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
