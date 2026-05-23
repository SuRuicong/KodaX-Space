// AgentModeSelector — KodaX agent 形态切换
//
// KodaX 内核两种工作形态：
//   - AMA (默认) — Adaptive Multi-Agent: scout/planner/generator/evaluator 多角色协作，
//     更聪明，对复杂任务效果好；token 消耗高，需要 provider 并发余量
//   - SA — Single Agent: 单 agent loop，结构最简单，token + 并发都省。接口并发受限
//     (rate limit / 多用户共享 quota / fallback to cheaper provider) 时显式降级
//
// UI 行为：
//   - 紧贴 ModeSelector 旁的小 chip：显示 "AMA" / "SA"
//   - 点开 popup 列两个选项 + 说明
//   - 切换不重启 session — 下一条 prompt 走新形态
//   - 无 session 时存进 pendingAgentMode；session.create 时入参传给 main
//
// 默认全 ama；用户主动选 sa 才走 fallback。

import { useEffect, useState } from 'react';
import type { AgentMode } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

const LABELS: Record<AgentMode, string> = {
  ama: 'AMA',
  sa: 'SA',
};

const FULL_NAMES: Record<AgentMode, string> = {
  ama: 'Adaptive Multi-Agent',
  sa: 'Single Agent',
};

const DESCRIPTIONS: Record<AgentMode, string> = {
  ama: '多角色协作（scout / planner / generator / evaluator）— 复杂任务效果更好，但 token 消耗 + 并发更高',
  sa: '单 agent loop — 资源 / 并发受限时的 fallback；省 token、省请求并发',
};

export function AgentModeSelector(): JSX.Element {
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const pendingAgentMode = useAppStore((s) => s.pendingAgentMode);
  const setPendingAgentMode = useAppStore((s) => s.setPendingAgentMode);

  const session = sessions.find((x) => x.sessionId === currentSessionId);
  const current: AgentMode = session?.agentMode ?? pendingAgentMode ?? 'ama';

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function pick(mode: AgentMode): Promise<void> {
    if (busy || mode === current) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      if (session && window.kodaxSpace) {
        upsertSession({ ...session, agentMode: mode }); // 乐观更新
        const r = await window.kodaxSpace.invoke('session.setAgentMode', {
          sessionId: session.sessionId,
          agentMode: mode,
        });
        if (!r.ok) {
          upsertSession({ ...session, agentMode: current }); // 回滚
        }
      } else {
        setPendingAgentMode(mode);
      }
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  // P3: Alt+M 在 AMA / SA 间快速切换（对齐 KodaX TUI 的 Meta+M；Win 上 Meta 没标准键所以用 Alt）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        void pick(current === 'ama' ? 'sa' : 'ama');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, busy]);

  const labelText = session ? LABELS[current] : `${LABELS[current]} (next)`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 flex items-center gap-1"
        title={`Agent: ${FULL_NAMES[current]}`}
      >
        <span>{labelText}</span>
        <span className="text-zinc-400" aria-hidden>+</span>
      </button>

      {open && (
        <div
          className="absolute left-0 bottom-full mb-1 w-72 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-3 py-1 text-zinc-500 text-[10px] uppercase tracking-wider">
            Agent mode
          </div>
          {(['ama', 'sa'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => void pick(m)}
              className={`w-full text-left px-3 py-1.5 hover:bg-zinc-800 ${
                current === m ? 'text-zinc-100' : 'text-zinc-300'
              }`}
              title={DESCRIPTIONS[m]}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono w-9">{LABELS[m]}</span>
                <span className="flex-1 text-[11px]">{FULL_NAMES[m]}</span>
                {current === m && <span className="text-emerald-500" aria-hidden>✓</span>}
              </div>
              <div className="ml-9 text-[10px] text-zinc-500 leading-tight">{DESCRIPTIONS[m]}</div>
            </button>
          ))}
          <div className="border-t border-zinc-800 mt-1 pt-1 px-3 py-1 text-[10px] text-zinc-500 leading-tight">
            默认 AMA；接口并发受限时切到 SA 降级
          </div>
        </div>
      )}
    </div>
  );
}
