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
import { pushToast } from '../store/toastStore.js';
import { resolveActiveModel } from './resolveActiveModel.js';

type ReasoningMode = SessionMeta['reasoningMode'];

const EFFORT_LABEL: Record<ReasoningMode, string> = {
  off: 'Low',
  quick: 'Med',
  balanced: 'High',
  auto: 'Higher',
  deep: 'Max',
};
const EFFORT_ORDER: readonly ReasoningMode[] = ['off', 'quick', 'balanced', 'auto', 'deep'];

export function ModelEffortSelector(): JSX.Element {
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const runtimeDefaults = useAppStore((s) => s.runtimeDefaults);
  const pendingProviderId = useAppStore((s) => s.pendingProviderId);
  const pendingReasoningMode = useAppStore((s) => s.pendingReasoningMode);
  const pendingModel = useAppStore((s) => s.pendingModel);
  const setPendingProviderId = useAppStore((s) => s.setPendingProviderId);
  const setPendingReasoningMode = useAppStore((s) => s.setPendingReasoningMode);
  const setPendingModel = useAppStore((s) => s.setPendingModel);
  const setRuntimeDefaults = useAppStore((s) => s.setRuntimeDefaults);
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
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 当前 active provider/model/effort（用 session > pending > defaults）
  const activeProviderId =
    session?.provider ?? pendingProviderId ?? defaultProviderId ?? kodaxDefaults?.provider ?? null;
  const activeProvider: ProviderInfo | undefined = activeProviderId
    ? providers.find((p) => p.id === activeProviderId)
    : undefined;
  // Preference/default model is only a preview source. For an active session,
  // runtime session.model is authoritative; when it is unset the SDK will use
  // the provider default, regardless of pendingModel or KodaX config defaults.
  const preferredModel: string = resolveActiveModel({
    activeProviderId,
    activeProviderModels: activeProvider?.models,
    activeProviderDefaultModel: activeProvider?.defaultModel,
    pendingModel,
    kodaxDefaultsProvider: kodaxDefaults?.provider,
    kodaxDefaultsModel: kodaxDefaults?.model,
  });
  const runtimeModel = session ? (session.model ?? activeProvider?.defaultModel ?? '—') : undefined;
  const activeModel = runtimeModel ?? preferredModel;
  const activeEffort: ReasoningMode =
    session?.reasoningMode ??
    pendingReasoningMode ??
    runtimeDefaults.reasoningMode ??
    kodaxDefaults?.reasoningMode ??
    'auto';

  // 右列正在预览的 provider — 打开时初始化为 active；用户左列点别的就更新 preview
  const previewProvider = providers.find((p) => p.id === (previewProviderId ?? activeProviderId));
  const previewModels =
    previewProvider?.models ??
    (previewProvider?.defaultModel ? [previewProvider.defaultModel] : []);

  const configuredProviders = providers
    .filter((p) => p.configured)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  async function commitProviderAndModel(providerId: string, model: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      // provider 选择持久化到 ~/.kodax/space/provider-config.json（defaultProviderId 是
      // default provider 的权威持久层）——让下次启动沿用上次选择。pendingProviderId 是
      // 一次性临时层（session 创建后被 BottomBar/LeftSidebar 清空），不做持久层。
      // 仅在真的换了 provider 时写（避免重复 IPC + main 侧 injectAllKeysToEnv）；失败不静默吞，
      // 至少 log 让"重启没沿用"可诊断。
      if (window.kodaxSpace && providerId !== defaultProviderId) {
        try {
          const r = await window.kodaxSpace.invoke('provider.setDefault', { providerId });
          if (!r.ok) console.warn('[picker] provider.setDefault failed:', r.error);
        } catch (err) {
          console.warn('[picker] provider.setDefault threw:', err);
        }
      }
      if (session && window.kodaxSpace) {
        const providerChanged = providerId !== session.provider;
        const currentRuntimeModel = providerChanged
          ? undefined
          : (session.model ?? activeProvider?.defaultModel ?? '—');
        if (model !== currentRuntimeModel || session.model === undefined || providerChanged) {
          const modelArg = providerChanged ? `${providerId}/${model}` : model;
          const r = await window.kodaxSpace.invoke('slash.exec', {
            sessionId: session.sessionId,
            name: 'model',
            args: [modelArg],
            expectedProjectRoot: session.projectRoot,
            expectedSurface: session.surface,
          });
          if (!r.ok) {
            console.warn('[picker] /model failed:', r.error);
            return;
          }
          if (!r.data.ok) {
            console.warn('[picker] /model failed:', r.data.message);
            return;
          }
          upsertSession({ ...session, provider: providerId, model });
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
    // Always update pending as the user's next-session preference.
    setPendingReasoningMode(mode);
    try {
      if (session && window.kodaxSpace) {
        const r = await window.kodaxSpace.invoke('session.setReasoningMode', {
          sessionId: session.sessionId,
          mode,
        });
        if (r.ok) upsertSession({ ...session, reasoningMode: mode });
      }
      if (window.kodaxSpace) {
        const r = await window.kodaxSpace.invoke('settings.setRuntimeDefaults', {
          runtimeDefaults: { reasoningMode: mode },
        });
        if (!r.ok) pushToast(r.error?.message ?? 'Failed to save runtime defaults', 'error');
        else setRuntimeDefaults(r.data.runtimeDefaults ?? {});
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to save runtime defaults', 'error');
    } finally {
      setBusy(false);
    }
  }

  // Ctrl+Shift+E matches the Effort shortcut shown in the picker.
  // Keep Ctrl+T as a legacy cycle shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase();
      const isLegacyCycle = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && key === 't';
      const isEffortCycle = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && key === 'e';
      if (isLegacyCycle || isEffortCycle) {
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

  // Button label 拆两行：long provider name 不再挤掉 model/effort
  // Top: provider displayName
  // Bottom: model · effort + (next) 后缀
  const providerLabel = activeProvider?.displayName ?? activeProviderId ?? 'pick provider';
  // 同 ModeSelector：用 currentSessionId 判定，避免 sessions[] race 误显示 (next)
  const effortLabel = EFFORT_LABEL[activeEffort];
  const modelEffortLine = currentSessionId
    ? `${activeModel} · ${effortLabel}`
    : `${activeModel} · ${effortLabel} (next)`;

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
        className="font-mono text-[11px] hover:text-fg-primary flex items-center gap-1.5"
        title={
          session ? 'Change provider/model/effort' : 'Pick provider/model/effort for next session'
        }
      >
        {/* 两行：上行 provider displayName（强调），下行 model · effort（次要） */}
        <span className="flex flex-col items-end leading-tight text-right">
          <span className="text-fg-primary truncate max-w-[260px]">{providerLabel}</span>
          <span className="text-fg-muted truncate max-w-[260px]">{modelEffortLine}</span>
        </span>
        <span className="text-fg-muted" aria-hidden>
          ▿
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-full mb-2 w-[460px] bg-surface-4 border border-border-default rounded-lg shadow-xl text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          {/* 2 列：Provider | Model */}
          <div className="grid grid-cols-2 gap-0">
            <div className="border-r border-border-default">
              <div className="px-3 py-1 flex justify-between items-center text-fg-muted text-[11px] uppercase tracking-wider">
                <span>Provider</span>
                <span className="font-mono text-fg-muted flex items-center gap-1">
                  <kbd className="px-1 border border-border-strong rounded">Ctrl</kbd>
                  <kbd className="px-1 border border-border-strong rounded">I</kbd>
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {configuredProviders.length === 0 ? (
                  <div className="px-3 py-1 text-fg-muted text-[11px]">
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
                        className={`w-full text-left px-3 py-1 hover:bg-hover-bg flex items-center gap-2 ${
                          isPreviewing ? 'bg-surface-3/60 text-fg-primary' : 'text-fg-secondary'
                        }`}
                        title={p.displayName}
                      >
                        <span className="truncate flex-1">{p.displayName}</span>
                        {isActive && (
                          <span className="text-ok" aria-hidden>
                            ✓
                          </span>
                        )}
                        {idx < 9 && (
                          <span className="text-fg-muted text-[11px] font-mono w-3 text-right">
                            {idx + 1}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <div className="px-3 py-1 flex justify-between items-center text-fg-muted text-[11px] uppercase tracking-wider">
                <span>Model</span>
                {!session && <span className="text-warn normal-case">for next session</span>}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {previewModels.length === 0 ? (
                  <div className="px-3 py-1 text-fg-muted text-[11px]">No models</div>
                ) : (
                  previewModels.map((m) => {
                    const isActive = activeProviderId === previewProvider?.id && activeModel === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => void commitProviderAndModel(previewProvider?.id ?? '', m)}
                        disabled={!previewProvider}
                        className={`w-full text-left px-3 py-1 hover:bg-hover-bg flex items-center gap-2 ${
                          isActive ? 'text-fg-primary' : 'text-fg-secondary'
                        }`}
                      >
                        <span className="truncate flex-1 font-mono">{m}</span>
                        {isActive && (
                          <span className="text-ok" aria-hidden>
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Effort 行（横跨 2 列底部） */}
          <div className="border-t border-border-default pt-1">
            <div className="px-3 py-1 flex justify-between items-center text-fg-muted text-[11px] uppercase tracking-wider">
              <span>Effort</span>
              <span className="font-mono text-fg-muted flex items-center gap-1">
                <kbd className="px-1 border border-border-strong rounded">⇧</kbd>
                <kbd className="px-1 border border-border-strong rounded">Ctrl</kbd>
                <kbd className="px-1 border border-border-strong rounded">E</kbd>
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
                    className={`text-center px-1 py-1 rounded hover:bg-hover-bg ${
                      selected ? 'bg-surface-3 text-fg-primary' : 'text-fg-secondary'
                    }`}
                  >
                    {EFFORT_LABEL[m]}
                    {selected && (
                      <span className="ml-0.5 text-ok" aria-hidden>
                        ✓
                      </span>
                    )}
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
