// ModeSelector — FEATURE_029 canonical 3 mode + auto engine 子档
//
// 对齐 KodaX REPL (ADR-005)：
//
//   ┌──────────────────────────────┐
//   │ Mode                Ctrl+M   │
//   │   Plan                 1     │
//   │   Accept edits  ✓      2     │
//   │   Auto                 3     │
//   │     ┌─ engine ──────────┐    │
//   │     │ ● llm             │    │  (auto 选中时显示子菜单)
//   │     │ ○ rules           │    │
//   │     └───────────────────┘    │
//   └──────────────────────────────┘
//
// 切 mode 立即生效（main 端 broker 下次 tool call 走新短路）。
// 切 engine 同上 — 即便当前 mode 不是 auto 也接受（下次切到 auto 时按新 engine bootstrap guardrail）。
// Shift-Tab / Ctrl+M 循环 3 档；数字键 1/2/3 直接切。

import { useEffect, useState } from 'react';
import type { AutoModeEngine, PermissionMode } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

const MODE_LABELS: Record<PermissionMode, string> = {
  plan: 'Plan',
  'accept-edits': 'Accept edits',
  auto: 'Auto',
};

const MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
  plan: '只规划不执行（全 deny mutating tools）',
  'accept-edits': 'edit/write 自动批，bash/network 弹窗',
  auto: '由 AutoModeToolGuardrail 守门（llm 分类器 或 rules）',
};

const MODE_ORDER: readonly PermissionMode[] = ['plan', 'accept-edits', 'auto'];

const ENGINE_LABELS: Record<AutoModeEngine, string> = {
  llm: 'llm',
  rules: 'rules',
};

const ENGINE_DESCRIPTIONS: Record<AutoModeEngine, string> = {
  llm: 'classifier sideQuery 让 LLM 判断 risk',
  rules: '走 ~/.kodax/auto-rules.jsonc + 内置 signals',
};

export function ModeSelector(): JSX.Element | null {
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const session = sessions.find((x) => x.sessionId === currentSessionId);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Ctrl+M 切换打开；数字键 1/2/3 切 mode；L/R 切 engine（auto 时）
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (open && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const idx = ['1', '2', '3'].indexOf(e.key);
        if (idx >= 0) {
          e.preventDefault();
          void setMode(MODE_ORDER[idx]);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, open]);

  if (!session) return null;
  const current = session.permissionMode ?? 'accept-edits';
  const engine: AutoModeEngine = session.autoModeEngine ?? 'llm';

  async function setMode(mode: PermissionMode): Promise<void> {
    if (!window.kodaxSpace || busy || !session || mode === current) return;
    setBusy(true);
    // 乐观更新：先把 store 中 session.permissionMode 改了，让 engine 子菜单立即渲染，
    // 防止用户点 'Auto' → IPC round-trip 期间鼠标轻微移动触发 onMouseLeave 关闭 popover。
    // 失败时回滚（罕见——main host 永远 return ok:true for 合法 enum）
    upsertSession({ ...session, permissionMode: mode });
    if (mode !== 'auto') setOpen(false);
    try {
      const r = await window.kodaxSpace.invoke('session.setPermissionMode', {
        sessionId: session.sessionId,
        mode,
      });
      if (!r.ok) {
        upsertSession({ ...session, permissionMode: current });
      }
    } finally {
      setBusy(false);
    }
  }

  async function setEngine(next: AutoModeEngine): Promise<void> {
    if (!window.kodaxSpace || busy || !session || next === engine) return;
    setBusy(true);
    try {
      const r = await window.kodaxSpace.invoke('session.setAutoModeEngine', {
        sessionId: session.sessionId,
        engine: next,
      });
      if (r.ok) {
        upsertSession({ ...session, autoModeEngine: next });
      }
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = current === 'auto'
    ? `Auto · ${ENGINE_LABELS[engine]}`
    : MODE_LABELS[current];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 flex items-center gap-1"
        title={`Mode: ${statusLabel} (Ctrl+M)`}
      >
        <span>{statusLabel}</span>
        <span className="text-zinc-600" aria-hidden>+</span>
      </button>

      {open && (
        <div
          className="absolute left-0 bottom-full mb-1 w-60 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-3 py-1 flex justify-between text-zinc-500 text-[10px] uppercase tracking-wider">
            <span>Mode</span>
            <span className="text-zinc-700">Ctrl+M</span>
          </div>
          {MODE_ORDER.map((m, idx) => (
            <button
              key={m}
              type="button"
              onClick={() => void setMode(m)}
              className={`w-full text-left px-3 py-1 hover:bg-zinc-800 flex items-center gap-2 ${
                current === m ? 'text-zinc-100' : 'text-zinc-400'
              }`}
              title={MODE_DESCRIPTIONS[m]}
            >
              <span>{MODE_LABELS[m]}</span>
              <span className="ml-auto text-zinc-600 text-[10px]">{idx + 1}</span>
              {current === m && <span className="text-emerald-500 ml-1" aria-hidden>✓</span>}
            </button>
          ))}

          {current === 'auto' && (
            <>
              <div className="border-t border-zinc-800 mt-1 pt-1">
                <div className="px-3 py-1 text-zinc-500 text-[10px] uppercase tracking-wider">
                  Auto engine
                </div>
                {(['llm', 'rules'] as const).map((eng) => (
                  <button
                    key={eng}
                    type="button"
                    onClick={() => void setEngine(eng)}
                    className={`w-full text-left px-3 py-1 hover:bg-zinc-800 flex items-center gap-2 ${
                      engine === eng ? 'text-zinc-100' : 'text-zinc-400'
                    }`}
                    title={ENGINE_DESCRIPTIONS[eng]}
                  >
                    <span className={engine === eng ? 'text-emerald-500' : 'text-zinc-600'} aria-hidden>
                      {engine === eng ? '●' : '○'}
                    </span>
                    <span>{ENGINE_LABELS[eng]}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
