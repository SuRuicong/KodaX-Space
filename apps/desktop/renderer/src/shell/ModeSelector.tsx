// ModeSelector — alpha.1
//
// Claude Desktop "Accept edits" 按钮（截图 4）：
//
//   ┌──────────────────────────────┐
//   │ Mode                Ctrl+M   │
//   │   Ask permissions      1     │
//   │   Accept edits ✓       2     │
//   │   Plan mode            3     │
//   │ ─────────────────────────── │
//   │ Bypass permissions           │  (灰：Enable in Claude Code settings)
//   └──────────────────────────────┘
//
// 切 mode 立即生效（main 端 PermissionBroker 下次 tool call 走新短路逻辑）。
// Bypass 需 settings.bypass_permissions_enabled = true 才能选——alpha.1 settings 未上，
// 默认锁死。后续可加 ProviderSettings 解锁 flag。

import { useEffect, useState } from 'react';
import type { PermissionMode } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

const MODE_LABELS: Record<PermissionMode, string> = {
  'ask-permissions': 'Ask permissions',
  'accept-edits': 'Accept edits',
  'plan-mode': 'Plan mode',
  'bypass-permissions': 'Bypass permissions',
};

const MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
  'ask-permissions': '每次工具调用都弹窗',
  'accept-edits': 'edit/write 自动批，dangerous 仍弹',
  'plan-mode': '只规划不执行（全 deny）',
  'bypass-permissions': '全放（含危险）— 慎用',
};

const MODE_ORDER: readonly PermissionMode[] = [
  'ask-permissions',
  'accept-edits',
  'plan-mode',
];

// alpha.1：bypass 锁死，settings unlock 留后续。
const BYPASS_UNLOCKED = false;

export function ModeSelector(): JSX.Element | null {
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const session = sessions.find((x) => x.sessionId === currentSessionId);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Ctrl+M 切换打开
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      // 数字键 1/2/3 当 popover 打开时切 mode
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
  const current = session.permissionMode ?? 'ask-permissions';

  async function setMode(mode: PermissionMode): Promise<void> {
    if (!window.kodaxSpace || busy || !session || mode === current) return;
    if (mode === 'bypass-permissions' && !BYPASS_UNLOCKED) return;
    setBusy(true);
    try {
      const r = await window.kodaxSpace.invoke('session.setPermissionMode', {
        sessionId: session.sessionId,
        mode,
      });
      if (r.ok) {
        upsertSession({ ...session, permissionMode: mode });
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 flex items-center gap-1"
        title={`Mode: ${MODE_LABELS[current]} (Ctrl+M)`}
      >
        <span>{MODE_LABELS[current]}</span>
        <span className="text-zinc-600" aria-hidden>+</span>
      </button>

      {open && (
        <div
          className="absolute left-0 bottom-full mb-1 w-56 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 text-xs z-50"
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
          <div className="border-t border-zinc-800 mt-1 pt-1">
            <button
              type="button"
              disabled={!BYPASS_UNLOCKED}
              onClick={() => void setMode('bypass-permissions')}
              className={`w-full text-left px-3 py-1 flex flex-col gap-0.5 ${
                BYPASS_UNLOCKED ? 'hover:bg-zinc-800 text-amber-400' : 'text-zinc-700 cursor-not-allowed'
              }`}
            >
              <span>Bypass permissions</span>
              {!BYPASS_UNLOCKED && (
                <span className="text-[9px] text-zinc-700">
                  Enable in KodaX Space settings
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
