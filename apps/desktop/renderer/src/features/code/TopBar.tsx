// TopBar — F008 当前 session 的运行状态条。
//
// 布局（左→右）：
//   [Provider dropdown]  [Work x/y bar]  [Harness badge]  [Reasoning dropdown]
//
// 切 provider / reasoning 不重启 session——新设置应用于下一条 prompt。
// 切换时立即发 IPC + 在本地组件 state 反映；session.list 不需要刷新（meta
// 在 main 端已更新，下次 session.list 拉到的就是新值）。
//
// "Provider dropdown" 复用 SessionList 的策略：Mock + 已配 key 的 provider（前）+
// 未配 key 的 provider（后，disabled）。F004 store.providers 是数据源。
//
// 注：不显示当前 model——session 创建时 provider 默认 model 已经定，
// 切 reasoning mode 不变 model。换 model 待 F008-extended chore 做（不在本期）。

import { useState } from 'react';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { WorkBudget } from './WorkBudget.js';
import { HarnessBadge } from './HarnessBadge.js';

const REASONING_MODES = ['off', 'auto', 'quick', 'balanced', 'deep'] as const;
type ReasoningMode = (typeof REASONING_MODES)[number];

const MOCK_PROVIDER = 'mock';

interface TopBarProps {
  readonly session: SessionMeta;
}

export function TopBar({ session }: TopBarProps): JSX.Element {
  const providers = useAppStore((s) => s.providers);
  const budget = useAppStore((s) => s.workBudgetBySession[session.sessionId]);
  const harness = useAppStore((s) => s.harnessProfileBySession[session.sessionId]);
  const upsertSession = useAppStore((s) => s.upsertSession);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 同 SessionList：Mock 第一，已配的在前，未配的 disabled
  const providerOptions = [
    { id: MOCK_PROVIDER, displayName: 'Mock', configured: true },
    ...providers
      .filter((p) => p.configured)
      .map((p) => ({ id: p.id, displayName: p.displayName, configured: true })),
    ...providers
      .filter((p) => !p.configured)
      .map((p) => ({ id: p.id, displayName: `${p.displayName} (not configured)`, configured: false })),
  ];

  async function handleProviderChange(providerId: string): Promise<void> {
    if (!window.kodaxSpace || providerId === session.provider) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('session.setProvider', {
        sessionId: session.sessionId,
        providerId,
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      // 乐观更新本地 session meta——下次 session.list 拉到的就是新值
      upsertSession({ ...session, provider: providerId });
    } finally {
      setBusy(false);
    }
  }

  async function handleReasoningChange(mode: ReasoningMode): Promise<void> {
    if (!window.kodaxSpace || mode === session.reasoningMode) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('session.setReasoningMode', {
        sessionId: session.sessionId,
        mode,
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      upsertSession({ ...session, reasoningMode: mode });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-zinc-800 px-4 py-1.5 flex items-center gap-3 flex-shrink-0 text-xs">
      {/* 左：provider dropdown */}
      <select
        value={session.provider}
        onChange={(e) => void handleProviderChange(e.target.value)}
        disabled={busy}
        className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-1.5 py-0.5 max-w-[180px]"
        title="Provider for next prompt"
      >
        {providerOptions.map((p) => (
          <option
            key={p.id}
            value={p.id}
            disabled={!p.configured && p.id !== MOCK_PROVIDER}
          >
            {p.displayName}
          </option>
        ))}
        {/* 防御：当前 session.provider 不在 providers 列表（旧 session / 已删 custom）时
            仍能显示，不被 select 强制重置 */}
        {!providerOptions.some((p) => p.id === session.provider) && (
          <option value={session.provider}>{session.provider}</option>
        )}
      </select>

      {/* 中：Work 预算 + harness badge */}
      <div className="flex items-center gap-2">
        <WorkBudget budget={budget} />
        <HarnessBadge profile={harness} />
      </div>

      {/* 右：reasoning mode dropdown */}
      <div className="ml-auto flex items-center gap-1.5">
        <span className="text-[10px] text-zinc-500 font-mono uppercase">Reasoning</span>
        <select
          value={session.reasoningMode}
          onChange={(e) => void handleReasoningChange(e.target.value as ReasoningMode)}
          disabled={busy}
          className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-1.5 py-0.5"
          title="Reasoning mode for next prompt"
        >
          {REASONING_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {err && (
        <span className="text-[10px] text-red-400 font-mono" title={err}>
          ⚠ {err.length > 40 ? `${err.slice(0, 40)}…` : err}
        </span>
      )}
    </div>
  );
}
