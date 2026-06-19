// AgentModeSelector — KodaX agent 形态切换
//
// KodaX 内核三种工作形态：
//   - AMA (默认) — Adaptive Multi-Agent: scout/planner/generator/evaluator 多角色协作，
//     更聪明，对复杂任务效果好；token 消耗高，需要 provider 并发余量
//   - AMAW — AMA + natural-language workflow activation.
//   - SA — Single Agent: 单 agent loop，结构最简单，token + 并发都省。接口并发受限
//     (rate limit / 多用户共享 quota / fallback to cheaper provider) 时显式降级
//
// UI 行为：
//   - 紧贴 ModeSelector 旁的小 chip：显示 "AMA" / "AMAW" / "SA"
//   - 点开 popup 列三个选项 + 说明
//   - 切换不重启 session — 下一条 prompt 走新形态
//   - 无 session 时存进 pendingAgentMode；session.create 时入参传给 main
//
// 默认全 ama；用户主动选 sa 才走 fallback。

import { useEffect, useState } from 'react';
import type { AgentMode } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

const LABELS: Record<AgentMode, string> = {
  ama: 'AMA',
  amaw: 'AMAW',
  sa: 'SA',
};

const FULL_NAMES: Record<AgentMode, string> = {
  ama: 'Adaptive Multi-Agent',
  amaw: 'Adaptive Multi-Agent Workflow',
  sa: 'Single Agent',
};

const DESCRIPTIONS: Record<AgentMode, string> = {
  amaw: 'Multi-agent work with natural-language workflow activation.',
  ama: '多角色协作（scout / planner / generator / evaluator）— 复杂任务效果更好，但 token 消耗 + 并发更高',
  sa: '单 agent loop — 资源 / 并发受限时的 fallback；省 token、省请求并发',
};

const OPTIONS: readonly AgentMode[] = ['ama', 'amaw', 'sa'];

function nextAgentMode(current: AgentMode): AgentMode {
  const idx = OPTIONS.indexOf(current);
  return OPTIONS[(idx + 1) % OPTIONS.length] ?? 'ama';
}

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
    // 不论有没有 session，都更新 pending — 持久化作下次默认
    setPendingAgentMode(mode);
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
      }
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  // P3: Alt+M cycles AMA / AMAW / SA.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        void pick(nextAgentMode(current));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, busy]);

  // 同 ModeSelector：用 currentSessionId 判定，避免 sessions[] race 误显示 (next)
  const labelText = currentSessionId ? LABELS[current] : `${LABELS[current]} (next)`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-2 py-0.5 rounded bg-surface-2 border border-border-default text-fg-secondary hover:bg-hover-bg flex items-center gap-1"
        title={`Agent: ${FULL_NAMES[current]}`}
      >
        <span>{labelText}</span>
        <span className="text-fg-muted" aria-hidden>
          +
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 bottom-full mb-1 w-72 bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-3 py-1 text-fg-muted text-[11px] uppercase tracking-wider">
            Agent mode
          </div>
          {OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => void pick(m)}
              className={`w-full text-left px-3 py-1.5 hover:bg-hover-bg ${
                current === m ? 'text-fg-primary' : 'text-fg-secondary'
              }`}
              title={DESCRIPTIONS[m]}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono w-12">{LABELS[m]}</span>
                <span className="flex-1 text-xs">{FULL_NAMES[m]}</span>
                {current === m && (
                  <span className="text-ok" aria-hidden>
                    ✓
                  </span>
                )}
              </div>
              <div className="ml-12 text-[11px] text-fg-muted leading-tight">{DESCRIPTIONS[m]}</div>
            </button>
          ))}
          <div className="border-t border-border-default mt-1 pt-1 px-3 py-1 text-[11px] text-fg-muted leading-tight">
            AMA uses explicit /workflow. AMAW can auto-start workflows from natural language.
          </div>
        </div>
      )}
    </div>
  );
}
