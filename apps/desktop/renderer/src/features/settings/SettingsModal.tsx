// OC-29 SettingsModal — v0.1.9
//
// 把分散在 SettingsPopover + ProviderSettings 两个独立 modal 的设置入口合并到一个
// 2-tab modal 里。打开时可指定初始 tab：
//   - 'providers'   — 之前 App.tsx 通过 kodax-space.open-provider-settings 事件打开
//   - 'preferences' — 之前 ChipBar Local chip ⚙ 打开
//
// 共享外层 chrome（backdrop + Esc / × 关 / fixed 居中），tab 切换是组件本地 state。

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { ProviderCard } from '../provider/ProviderCard.js';
import { CustomProviderForm } from '../provider/CustomProviderForm.js';

export type SettingsTab = 'providers' | 'preferences';

interface SettingsModalProps {
  readonly initialTab?: SettingsTab;
  readonly onClose: () => void;
}

export function SettingsModal({ initialTab = 'preferences', onClose }: SettingsModalProps): JSX.Element {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  // Esc 关
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      onClick={onClose}
    >
      <div
        className="w-[820px] max-w-[95vw] h-[640px] max-h-[90vh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl text-sm text-zinc-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-800 px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
          <h2 id="settings-modal-title" className="text-sm font-semibold text-zinc-100">
            Settings
          </h2>
          <div
            role="tablist"
            aria-label="Settings sections"
            className="flex items-center gap-1 ml-2 text-xs"
          >
            <TabButton
              id="settings-tab-preferences"
              active={tab === 'preferences'}
              onClick={() => setTab('preferences')}
              controlsId="settings-panel-preferences"
            >
              Preferences
            </TabButton>
            <TabButton
              id="settings-tab-providers"
              active={tab === 'providers'}
              onClick={() => setTab('providers')}
              controlsId="settings-panel-providers"
            >
              Providers
            </TabButton>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-2 py-0.5 text-xs rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
            aria-label="Close settings (Esc)"
            title="Esc"
          >
            Close (Esc)
          </button>
        </div>

        {/* 两个 panel 都常驻挂载，仅用 hidden 切换可见性 — 避免 tab 切换时 in-progress
         * 编辑（半填写的 workspace 输入 / 半填写的 + Add custom 表单）被 unmount 清掉。 */}
        <div className="flex-1 overflow-y-auto">
          <div
            id="settings-panel-preferences"
            role="tabpanel"
            aria-labelledby="settings-tab-preferences"
            hidden={tab !== 'preferences'}
          >
            <PreferencesPanel />
          </div>
          <div
            id="settings-panel-providers"
            role="tabpanel"
            aria-labelledby="settings-tab-providers"
            hidden={tab !== 'providers'}
          >
            <ProvidersPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

interface TabButtonProps {
  readonly id: string;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly controlsId: string;
  readonly children: React.ReactNode;
}

function TabButton({ id, active, onClick, controlsId, children }: TabButtonProps): JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controlsId}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`px-3 py-1 rounded ${
        active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
      }`}
    >
      {children}
    </button>
  );
}

// ---- Preferences tab ----
//
// 当前只有 Default workspace 一项；逻辑直接搬自旧 SettingsPopover。

function PreferencesPanel(): JSX.Element {
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);

  const [defaultWorkspace, setDefaultWorkspace] = useState('');
  const [originalDefault, setOriginalDefault] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!window.kodaxSpace) return;
    void window.kodaxSpace.invoke('settings.get', {}).then((r) => {
      if (r.ok) {
        setDefaultWorkspace(r.data.defaultWorkspace);
        setOriginalDefault(r.data.defaultWorkspace);
      }
    });
  }, []);

  async function browseFolder(): Promise<void> {
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('project.openDialog', undefined);
    if (r.ok && r.data.path !== null) {
      setDefaultWorkspace(r.data.path);
    }
  }

  async function save(): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const trimmed = defaultWorkspace.trim();
      if (!trimmed) {
        setErr('Path cannot be empty.');
        return;
      }
      const r = await window.kodaxSpace.invoke('settings.setDefaultWorkspace', { path: trimmed });
      if (!r.ok) {
        setErr(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'save failed'}`);
        return;
      }
      if (currentProjectPath === originalDefault) {
        setCurrentProject(r.data.defaultWorkspace);
        await window.kodaxSpace
          .invoke('project.recent.add', { path: r.data.defaultWorkspace })
          .catch(() => {});
        const listR = await window.kodaxSpace.invoke('project.list', undefined);
        if (listR.ok) useAppStore.getState().setProjects(listR.data.projects);
      }
      setOriginalDefault(r.data.defaultWorkspace);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-5 space-y-5">
      <section>
        <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
          Default workspace
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={defaultWorkspace}
            onChange={(e) => setDefaultWorkspace(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 px-2 py-1 rounded focus:outline-none focus:border-zinc-700 font-mono"
            placeholder="C:\Users\you\kodax_workspace"
          />
          <button
            type="button"
            onClick={() => void browseFolder()}
            className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded"
            title="Browse for folder"
          >
            Browse…
          </button>
        </div>
        <div className="text-[10px] text-zinc-500 mt-1">
          New sessions default to this folder. Auto-created if it doesn't exist.
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || defaultWorkspace.trim() === originalDefault.trim()}
            className="text-xs px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-zinc-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {err && <span className="text-red-400 text-xs">{err}</span>}
          {saved && <span className="text-emerald-400 text-xs">Saved.</span>}
        </div>
      </section>

      <section className="pt-3 border-t border-zinc-800">
        <SmartPopoutToggle />
      </section>

      <section className="pt-2 border-t border-zinc-800 text-[11px] text-zinc-500">
        More preferences (theme override, language, telemetry) will land in upcoming versions.
      </section>
    </div>
  );
}

// ---- KX-I-02 Smart Popout Director toggle ----

function SmartPopoutToggle(): JSX.Element {
  const enabled = useAppStore((s) => s.smartPopoutEnabled);
  const setEnabled = useAppStore((s) => s.setSmartPopoutEnabled);
  return (
    <div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 accent-emerald-500"
        />
        <div className="flex-1">
          <div className="text-xs text-zinc-200">Auto-open Plan / Diff / Tasks popouts</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            Director opens the right panel the first time a plan is drafted, a file is edited,
            or workers fan out — once per session per kind. Disable to keep popouts strictly
            manual.
          </div>
        </div>
      </label>
    </div>
  );
}

// ---- Providers tab ----
//
// 13 内置 + 自定义 providers；逻辑直接搬自旧 ProviderSettings。

function ProvidersPanel(): JSX.Element {
  const providers = useAppStore((s) => s.providers);
  const keychainBackend = useAppStore((s) => s.keychainBackend);
  const setProviders = useAppStore((s) => s.setProviders);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const builtIn = useMemo(() => providers.filter((p) => !p.isCustom), [providers]);
  const custom = useMemo(() => providers.filter((p) => p.isCustom), [providers]);

  async function refresh(): Promise<void> {
    if (!window.kodaxSpace) return;
    setLoading(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('provider.list', undefined);
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setProviders(result.data.providers, result.data.defaultProviderId, result.data.keychainBackend);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="px-4 py-4 space-y-6">
      <div className="text-xs text-zinc-500">
        {providers.filter((p) => p.configured).length} / {providers.length} configured
      </div>

      {err && (
        <div className="text-xs font-mono rounded p-2 border dark:text-red-300 dark:border-red-900 dark:bg-red-950/40 text-red-900 border-red-300 bg-red-50">
          {err}
        </div>
      )}

      {keychainBackend === 'memory' && (
        <div className="text-xs rounded p-3 border dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 border-amber-300 bg-amber-50 text-amber-900">
          <div className="font-semibold mb-1">⚠ Keychain unavailable — keys stored in memory only</div>
          <div className="dark:text-amber-200/80 text-amber-800">
            Could not load <code className="font-mono">keytar</code> or the system keychain
            (macOS Keychain / Windows Credential Manager / Linux libsecret). API keys you set
            here will work this session but <strong>will be lost on app restart</strong>.
            Install build tools (or libsecret on Linux) and reinstall to enable persistent storage.
          </div>
        </div>
      )}

      <section>
        <h3 className="text-xs uppercase font-mono text-zinc-500 mb-2">Built-in providers</h3>
        {loading && providers.length === 0 ? (
          <div className="text-xs text-zinc-500">Loading…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {builtIn.map((p) => (
              <ProviderCard key={p.id} provider={p} onChanged={refresh} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase font-mono text-zinc-500">Custom providers</h3>
          {!showCustomForm && (
            <button
              type="button"
              onClick={() => setShowCustomForm(true)}
              className="px-2 py-0.5 text-[10px] rounded bg-violet-800 text-violet-100 hover:bg-violet-700"
            >
              + Add custom
            </button>
          )}
        </div>
        {showCustomForm && (
          <div className="mb-3">
            <CustomProviderForm
              onAdded={async () => {
                setShowCustomForm(false);
                await refresh();
              }}
              onCancel={() => setShowCustomForm(false)}
            />
          </div>
        )}
        {custom.length === 0 ? (
          <div className="text-xs text-zinc-500">
            No custom providers yet. Use "+ Add custom" for OpenAI- or Anthropic-compatible
            endpoints (internal gateways, OpenRouter, LiteLLM, etc).
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {custom.map((p) => (
              <ProviderCard key={p.id} provider={p} onChanged={refresh} />
            ))}
          </div>
        )}
      </section>

      <section className="pt-2 border-t border-zinc-800">
        <h3 className="text-xs uppercase font-mono text-zinc-500 mb-1">About</h3>
        <ul className="text-[11px] text-zinc-500 space-y-0.5 list-disc list-inside">
          <li>API keys are stored in your OS keychain (macOS Keychain / Win Credential Manager / Linux libsecret).</li>
          <li>Keys never leave the main process — the renderer only sees "configured: yes/no".</li>
          <li>Set a default provider to make new sessions use it automatically.</li>
          <li>Custom providers persist to <code>~/.kodax/custom-providers.json</code> (shared with the KodaX CLI).</li>
        </ul>
      </section>
    </div>
  );
}
