// ProviderCard — F004 设置面板里一张 provider 卡片。
//
// 状态机：
//   - 未配置 key：显示"Set API key"按钮
//   - 已配置：脱敏显示 apiKeyEnv + 按钮 Test connection / Set default / Remove key
//   - 测连接进行中：spinner + 禁用按钮
//   - 测试结果：tag 显示 "OK 234ms" / "unauthorized" 等
//
// 安全说明：
//   - 卡片不显示 API key 值——store 里就没这字段（main 端只回 configured: boolean）
//   - 输入框 type=password 默认不显示输入值；用户可点 👁 切换显示但仅本地、不存
//   - 失去焦点 / 提交后立刻 setApiKey(''), 不在 React state 长期保留

import { useState } from 'react';
import type { ProviderInfo } from '@kodax-space/space-ipc-schema';

interface ProviderCardProps {
  readonly provider: ProviderInfo;
  readonly onChanged: () => Promise<void>;
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; latencyMs: number }
  | { kind: 'fail'; error: string };

export function ProviderCard({ provider, onChanged }: ProviderCardProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [err, setErr] = useState<string | null>(null);

  async function handleSave(): Promise<void> {
    if (!window.kodaxSpace) return;
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setErr(null);
    // review M1-code：成功 / 失败 / 异常都立即清 draft——key 不该在 React state 持久存在
    // 让 GC 能在下一帧回收。出错时用户需要重新粘贴，是可接受的代价
    const submitted = trimmed;
    setDraft('');
    setReveal(false);
    try {
      const result = await window.kodaxSpace.invoke('provider.setKey', {
        providerId: provider.id,
        apiKey: submitted,
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setEditing(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusy(true);
    try {
      await window.kodaxSpace.invoke('provider.removeKey', { providerId: provider.id });
      setTest({ kind: 'idle' });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleTest(): Promise<void> {
    if (!window.kodaxSpace) return;
    setTest({ kind: 'testing' });
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('provider.test', { providerId: provider.id });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        setTest({ kind: 'idle' });
        return;
      }
      if (result.data.ok) {
        setTest({ kind: 'ok', latencyMs: result.data.latencyMs ?? 0 });
      } else {
        setTest({ kind: 'fail', error: result.data.error ?? 'unknown' });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setTest({ kind: 'idle' });
    }
  }

  async function handleSetDefault(): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusy(true);
    try {
      await window.kodaxSpace.invoke('provider.setDefault', { providerId: provider.id });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveCustom(): Promise<void> {
    if (!window.kodaxSpace || !provider.isCustom) return;
    if (
      !window.confirm(`Delete custom provider "${provider.displayName}"? Key will also be removed.`)
    ) {
      return;
    }
    setBusy(true);
    try {
      await window.kodaxSpace.invoke('provider.removeCustom', { providerId: provider.id });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      // Default provider 卡: dark 用半透深翠衬底 + 翠绿边, light 用浅翠衬底 + 中翠边
      // (亮模式下"哪个是默认 provider"得一眼能看出来)
      className={`border rounded-lg p-3 ${
        provider.isDefault
          ? 'dark:border-emerald-700 dark:bg-emerald-950/30 border-emerald-400 bg-emerald-50'
          : provider.configured
            ? 'border-border-strong bg-surface-2'
            : 'border-border-default bg-surface-2/40'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-fg-primary truncate">
              {provider.displayName}
            </span>
            {provider.isDefault && (
              <span className="px-1.5 py-0.5 text-[9px] font-mono rounded dark:bg-emerald-800 dark:text-emerald-100 bg-emerald-200 text-emerald-900">
                DEFAULT
              </span>
            )}
            {provider.isCustom && (
              <span className="px-1.5 py-0.5 text-[9px] font-mono rounded dark:bg-violet-800 dark:text-violet-100 bg-violet-200 text-violet-900">
                CUSTOM
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono text-fg-muted mt-0.5">{provider.id}</div>
          <div className="text-[11px] font-mono text-fg-faint">
            env: {provider.apiKeyEnv} · {provider.protocol}
          </div>
        </div>
        <div className="flex-shrink-0">
          {provider.configured ? (
            <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-emerald-900 text-emerald-200">
              CONFIGURED
            </span>
          ) : (
            <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-surface-3 text-fg-muted">
              NOT SET
            </span>
          )}
        </div>
      </div>

      {editing && (
        <div className="space-y-2 mt-2">
          <div className="flex items-center gap-1">
            <input
              type={reveal ? 'text' : 'password'}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Paste ${provider.apiKeyEnv}`}
              className="flex-1 bg-surface border border-border-strong rounded px-2 py-1 text-xs font-mono text-fg-primary outline-none focus:border-blue-500"
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              className="px-2 py-1 text-xs rounded bg-surface-3 text-fg-muted hover:bg-hover-bg"
              title={reveal ? 'Hide' : 'Show'}
              tabIndex={-1}
            >
              {reveal ? '🙈' : '👁'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy || draft.trim() === ''}
              className="px-3 py-1 text-xs rounded bg-blue-700 text-fg-primary hover:bg-blue-600 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft('');
                setReveal(false);
              }}
              disabled={busy}
              className="px-3 py-1 text-xs rounded bg-surface-3 text-fg-secondary hover:bg-hover-bg disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!editing && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {!provider.configured && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="px-2 py-1 text-xs rounded bg-blue-700 text-fg-primary hover:bg-blue-600 disabled:opacity-50"
            >
              Set API key
            </button>
          )}
          {provider.configured && (
            <>
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={busy || test.kind === 'testing'}
                className="px-2 py-1 text-xs rounded bg-surface-3 text-fg-primary hover:bg-hover-bg disabled:opacity-50"
              >
                {test.kind === 'testing' ? 'Testing…' : 'Test'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy}
                className="px-2 py-1 text-xs rounded bg-surface-3 text-fg-primary hover:bg-hover-bg disabled:opacity-50"
              >
                Update
              </button>
              {!provider.isDefault && (
                <button
                  type="button"
                  onClick={() => void handleSetDefault()}
                  disabled={busy}
                  className="px-2 py-1 text-xs rounded disabled:opacity-50 dark:bg-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-700 bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  Set default
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleRemove()}
                disabled={busy}
                className="px-2 py-1 text-xs rounded disabled:opacity-50 dark:bg-red-900 dark:text-red-100 dark:hover:bg-red-800 bg-red-600 text-white hover:bg-red-500"
              >
                Remove key
              </button>
            </>
          )}
          {provider.isCustom && (
            <button
              type="button"
              onClick={() => void handleRemoveCustom()}
              disabled={busy}
              className="px-2 py-1 text-xs rounded bg-surface-3 text-fg-muted hover:bg-red-900 hover:text-red-100 disabled:opacity-50"
            >
              Delete provider
            </button>
          )}
        </div>
      )}

      {test.kind === 'ok' && (
        <div className="mt-2 text-[11px] font-mono text-emerald-300">✓ OK · {test.latencyMs}ms</div>
      )}
      {test.kind === 'fail' && (
        <div className="mt-2 text-[11px] font-mono text-red-300">✗ {test.error}</div>
      )}
      {err && <div className="mt-2 text-[11px] font-mono text-red-400">{err}</div>}
    </div>
  );
}
