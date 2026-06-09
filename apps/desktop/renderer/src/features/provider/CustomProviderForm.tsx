// CustomProviderForm — F004 添加自定义 provider 表单。
//
// 字段：
//   - Display name      UI 显示文字
//   - Protocol          openai-compat / anthropic-compat
//   - Base URL          全 URL (https://api.example.com/v1)，main 端用它做 fetch
//   - apiKeyEnv         SDK 读 key 的环境变量名（多个 provider 可共用同一 env）
//   - Default model     这个 provider 的默认 model
//   - Models (optional) 候选 model 列表，逗号分隔
//
// 提交后 main 生成 providerId（custom_<8hex>），回流到 props.onAdded(id) 让父组件刷新列表。

import { useState } from 'react';

interface CustomProviderFormProps {
  readonly onAdded: (providerId: string) => Promise<void>;
  readonly onCancel: () => void;
}

export function CustomProviderForm({ onAdded, onCancel }: CustomProviderFormProps): JSX.Element {
  const [displayName, setDisplayName] = useState('');
  const [protocol, setProtocol] = useState<'openai' | 'anthropic'>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKeyEnv, setApiKeyEnv] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [modelsCsv, setModelsCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!window.kodaxSpace) return;
    setBusy(true);
    setErr(null);
    try {
      const models = modelsCsv
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const result = await window.kodaxSpace.invoke('provider.addCustom', {
        displayName: displayName.trim(),
        protocol,
        baseUrl: baseUrl.trim(),
        apiKeyEnv: apiKeyEnv.trim(),
        defaultModel: defaultModel.trim(),
        models: models.length > 0 ? models : undefined,
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      await onAdded(result.data.providerId);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  const valid =
    displayName.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    apiKeyEnv.trim().length > 0 &&
    defaultModel.trim().length > 0;

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="border border-thinking rounded-lg p-3 bg-thinking/10 space-y-2"
    >
      <div className="text-xs font-semibold text-thinking mb-1">Add custom provider</div>

      <Field label="Display name">
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="My Internal Gateway"
          className="w-full bg-surface border border-border-strong rounded px-2 py-1 text-xs text-fg-primary"
          required
        />
      </Field>

      <Field label="Protocol">
        <select
          value={protocol}
          onChange={(e) => setProtocol(e.target.value as 'openai' | 'anthropic')}
          className="w-full bg-surface border border-border-strong rounded px-2 py-1 text-xs text-fg-primary"
        >
          <option value="openai">OpenAI-compatible</option>
          <option value="anthropic">Anthropic-compatible</option>
        </select>
      </Field>

      <Field label="Base URL">
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          className="w-full bg-surface border border-border-strong rounded px-2 py-1 text-xs font-mono text-fg-primary"
          required
        />
      </Field>

      <Field label="API key env var">
        <input
          type="text"
          value={apiKeyEnv}
          onChange={(e) => setApiKeyEnv(e.target.value)}
          placeholder="CUSTOM_GW_API_KEY"
          className="w-full bg-surface border border-border-strong rounded px-2 py-1 text-xs font-mono text-fg-primary"
          required
        />
      </Field>

      <Field label="Default model">
        <input
          type="text"
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          placeholder="gpt-4o"
          className="w-full bg-surface border border-border-strong rounded px-2 py-1 text-xs font-mono text-fg-primary"
          required
        />
      </Field>

      <Field label="Models (comma-separated, optional)">
        <input
          type="text"
          value={modelsCsv}
          onChange={(e) => setModelsCsv(e.target.value)}
          placeholder="gpt-4o, gpt-4o-mini"
          className="w-full bg-surface border border-border-strong rounded px-2 py-1 text-xs font-mono text-fg-primary"
        />
      </Field>

      {err && <div className="text-[11px] font-mono text-danger">{err}</div>}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!valid || busy}
          className="px-3 py-1 text-xs rounded bg-thinking/15 text-thinking border border-thinking/50 hover:bg-thinking/25 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add provider'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1 text-xs rounded bg-surface-3 text-fg-secondary hover:bg-hover-bg disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <div className="text-[11px] font-mono uppercase text-fg-muted mb-0.5">{label}</div>
      {children}
    </label>
  );
}
