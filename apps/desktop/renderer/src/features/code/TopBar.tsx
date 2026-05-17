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
import { useAppStore } from '../../store/appStore.js';
import { WorkBudget } from './WorkBudget.js';
import { HarnessBadge } from './HarnessBadge.js';

const REASONING_MODES = ['off', 'auto', 'quick', 'balanced', 'deep'] as const;
type ReasoningMode = (typeof REASONING_MODES)[number];

function isReasoningMode(v: string): v is ReasoningMode {
  return (REASONING_MODES as readonly string[]).includes(v);
}

const MOCK_PROVIDER = 'mock';

interface TopBarProps {
  readonly sessionId: string;
}

/**
 * review F008 M-code-2：session 从 store 直接读，不再走 prop——避免父组件
 * stale closure 把旧 session 传下来导致 TopBar 显示一帧旧 provider 值。
 * 同源数据 + Zustand selector 重渲染保证最新值。
 */
export function TopBar({ sessionId }: TopBarProps): JSX.Element | null {
  const session = useAppStore((s) => s.sessions.find((x) => x.sessionId === sessionId) ?? null);
  const providers = useAppStore((s) => s.providers);
  const budget = useAppStore((s) => s.workBudgetBySession[sessionId]);
  const harness = useAppStore((s) => s.harnessProfileBySession[sessionId]);
  const upsertSession = useAppStore((s) => s.upsertSession);

  // review H1-code：原本一个 busy 变量被两个 dropdown 共用——快速连点同一 dropdown
  // 时第二个 finally 会提前清 busy，留个"看起来 enable 但 IPC 还在飞"的窗口。
  // 拆成两个独立状态，互不干扰
  const [providerBusy, setProviderBusy] = useState(false);
  const [reasoningBusy, setReasoningBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!session) return null;
  // TS 在 async 闭包里不保留 outer const 的 narrowing——本地 alias 把已 narrow 过的类型
  // 显式定型，下方闭包用 sess 就不会再被推回 SessionMeta | null
  const sess = session;

  // 同 SessionList：Mock 第一，已配的在前，未配的 disabled。
  // review L2-code：过滤掉任何 id==='mock' 的 store 条目，避免与硬编码 mock 重复
  const realProviders = providers.filter((p) => p.id !== MOCK_PROVIDER);
  const providerOptions = [
    { id: MOCK_PROVIDER, displayName: 'Mock', configured: true },
    ...realProviders
      .filter((p) => p.configured)
      .map((p) => ({ id: p.id, displayName: p.displayName, configured: true })),
    ...realProviders
      .filter((p) => !p.configured)
      .map((p) => ({ id: p.id, displayName: `${p.displayName} (not configured)`, configured: false })),
  ];

  async function handleProviderChange(providerId: string): Promise<void> {
    if (!window.kodaxSpace || providerId === sess.provider || providerBusy) return;
    setProviderBusy(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('session.setProvider', {
        sessionId: sess.sessionId,
        providerId,
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      // 乐观更新本地 session meta——下次 session.list 拉到的就是新值
      upsertSession({ ...sess,provider: providerId });
    } finally {
      setProviderBusy(false);
    }
  }

  async function handleReasoningChange(value: string): Promise<void> {
    // review L2-sec：select option 虽然是硬编码，但仍走 runtime guard——
    // 防止某天 select 改成自由文本输入或其他事件源
    if (!isReasoningMode(value)) return;
    if (!window.kodaxSpace || value === sess.reasoningMode || reasoningBusy) return;
    setReasoningBusy(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('session.setReasoningMode', {
        sessionId: sess.sessionId,
        mode: value,
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      upsertSession({ ...sess,reasoningMode: value });
    } finally {
      setReasoningBusy(false);
    }
  }

  return (
    <div className="border-b border-zinc-800 px-4 py-1.5 flex items-center gap-3 flex-shrink-0 text-xs">
      {/* 左：provider dropdown */}
      <select
        value={sess.provider}
        onChange={(e) => void handleProviderChange(e.target.value)}
        disabled={providerBusy}
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
        {/* 防御：当前 sess.provider 不在 providers 列表（旧 session / 已删 custom）时
            仍能显示，不被 select 强制重置 */}
        {!providerOptions.some((p) => p.id === sess.provider) && (
          <option value={sess.provider}>{sess.provider}</option>
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
          value={sess.reasoningMode}
          onChange={(e) => void handleReasoningChange(e.target.value)}
          disabled={reasoningBusy}
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
