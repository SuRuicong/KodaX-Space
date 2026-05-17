// ProviderSettings — F004 Provider 配置面板。
//
// 显示策略：
//   - 顶部状态条：keychain backend（"keys stored in OS keychain" / "⚠ in-memory only"）
//     —— Linux 没装 libsecret 时 fallback 给用户一个明确的告警
//   - Built-in providers 网格（13 张卡片）
//   - Custom providers 网格 + "+ Add custom" 按钮
//
// 数据流：
//   - useEffect 启动时 invoke provider.list 拉一次
//   - ProviderCard 内每次写操作（setKey / removeKey / setDefault）后调 onChanged
//     重新拉 list，保证 UI 跟 main state 同步
//
// 安全：
//   - 这个组件永远只取 store.providers / defaultProviderId（main 推过来的 boolean + 元数据）
//   - 不接触 key 明文（key 输入在 ProviderCard 内部 local state，提交后立即清空）

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { ProviderCard } from './ProviderCard.js';
import { CustomProviderForm } from './CustomProviderForm.js';

interface ProviderSettingsProps {
  readonly onClose: () => void;
}

export function ProviderSettings({ onClose }: ProviderSettingsProps): JSX.Element {
  const providers = useAppStore((s) => s.providers);
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
      setProviders(result.data.providers, result.data.defaultProviderId);
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
    <div
      className="fixed inset-0 z-40 bg-zinc-950 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="provider-settings-title"
    >
      <div className="border-b border-zinc-800 px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
        <h1 id="provider-settings-title" className="text-sm font-semibold text-zinc-100">
          Providers
        </h1>
        <span className="text-xs text-zinc-500">
          {providers.filter((p) => p.configured).length} / {providers.length} configured
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto px-3 py-1 text-xs rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
        >
          Close (Esc)
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {err && (
          <div className="text-xs font-mono text-red-300 border border-red-900 rounded p-2 bg-red-950/40">
            {err}
          </div>
        )}

        <section>
          <h2 className="text-xs uppercase font-mono text-zinc-500 mb-2">Built-in providers</h2>
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
            <h2 className="text-xs uppercase font-mono text-zinc-500">Custom providers</h2>
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
          <h2 className="text-xs uppercase font-mono text-zinc-500 mb-1">About</h2>
          <ul className="text-[11px] text-zinc-500 space-y-0.5 list-disc list-inside">
            <li>API keys are stored in your OS keychain (macOS Keychain / Win Credential Manager / Linux libsecret).</li>
            <li>Keys never leave the main process — the renderer only sees "configured: yes/no".</li>
            <li>Set a default provider to make new sessions use it automatically.</li>
            <li>Custom providers persist to <code>~/.kodax/custom-providers.json</code> (shared with the KodaX CLI).</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
