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
import { pushToast } from '../store/toastStore.js';
import { useIsStreaming } from './ActivitySpinner.js';

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

export function ModeSelector(): JSX.Element {
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const pendingPermissionMode = useAppStore((s) => s.pendingPermissionMode);
  const pendingAutoModeEngine = useAppStore((s) => s.pendingAutoModeEngine);
  const setPendingPermissionMode = useAppStore((s) => s.setPendingPermissionMode);
  const setPendingAutoModeEngine = useAppStore((s) => s.setPendingAutoModeEngine);
  const session = sessions.find((x) => x.sessionId === currentSessionId);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // v0.1.4：spinner 修复 —— "切 auto 时 session 还在跑"的提示从 main 端 push
  // session_error 改成 renderer 端 pushToast，避免 ActivitySpinner 误判 session 已结束
  const isStreaming = useIsStreaming();

  // 有 session 走 session.permissionMode；无 session 走 pendingPermissionMode；fallback 'accept-edits'
  const current: PermissionMode =
    session?.permissionMode ??
    pendingPermissionMode ??
    kodaxDefaults?.permissionMode ??
    'accept-edits';
  const engine: AutoModeEngine = session?.autoModeEngine ?? pendingAutoModeEngine ?? 'llm';

  // Ctrl+M 切换打开；数字键 1/2/3 切 mode；L/R 切 engine（auto 时）
  // Shift+Tab 循环 mode（对齐 KodaX TUI）。
  // 不再 gate 在 session 上——无 session 时也能 toggle pending mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // P3: Shift+Tab 在任意位置循环 permission mode（含 input 框 — 用户切完继续打字）
      if (e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        const idx = MODE_ORDER.indexOf(current);
        const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
        void setMode(next);
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
  }, [session, open, current]);

  async function persistRuntimeDefaults(runtimeDefaults: {
    readonly permissionMode?: PermissionMode;
    readonly autoModeEngine?: AutoModeEngine;
  }): Promise<void> {
    if (!window.kodaxSpace) return;
    try {
      const r = await window.kodaxSpace.invoke('settings.setRuntimeDefaults', { runtimeDefaults });
      if (!r.ok) {
        pushToast(r.error?.message ?? 'Failed to save runtime defaults', 'error');
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to save runtime defaults', 'error');
    }
  }

  async function setMode(mode: PermissionMode): Promise<void> {
    if (busy || mode === current) return;
    setBusy(true);
    if (mode !== 'auto') setOpen(false);
    // Always update pending as the user's next-session preference.
    setPendingPermissionMode(mode);
    try {
      if (session && window.kodaxSpace) {
        // Optimistically update the current session first.
        upsertSession({ ...session, permissionMode: mode });
        const r = await window.kodaxSpace.invoke('session.setPermissionMode', {
          sessionId: session.sessionId,
          mode,
        });
        if (!r.ok) {
          upsertSession({ ...session, permissionMode: current });
          pushToast(r.error?.message ?? 'Failed to update current session mode', 'error');
        } else if (mode === 'auto' && current !== 'auto' && isStreaming) {
          // Keep this as a toast instead of a session_error event; the current run
          // continues under its existing permission flow until the next send.
          pushToast(
            'Auto mode guardrail will activate on the NEXT send. Current run continues with non-guardrail permission flow.',
            'info',
            6000,
          );
        }
      }
      await persistRuntimeDefaults({ permissionMode: mode });
    } finally {
      setBusy(false);
    }
  }

  async function setEngine(next: AutoModeEngine): Promise<void> {
    if (busy || next === engine) return;
    setBusy(true);
    setPendingAutoModeEngine(next);
    try {
      if (session && window.kodaxSpace) {
        upsertSession({ ...session, autoModeEngine: next });
        const r = await window.kodaxSpace.invoke('session.setAutoModeEngine', {
          sessionId: session.sessionId,
          engine: next,
        });
        if (!r.ok) {
          upsertSession({ ...session, autoModeEngine: engine });
          pushToast(r.error?.message ?? 'Failed to update current auto engine', 'error');
        }
      }
      await persistRuntimeDefaults({ autoModeEngine: next });
    } finally {
      setBusy(false);
    }
  }

  const baseLabel = current === 'auto' ? `Auto · ${ENGINE_LABELS[engine]}` : MODE_LABELS[current];
  // (next) 仅在真没 active session（welcome screen）时显示——之前判 `!session` 会撞
  // session.list 替换 sessions[] 把 in-flight stub 短暂 stomp 掉的 race，让对话中也
  // 误显示 (next)。currentSessionId 是 true source of truth。
  const statusLabel = currentSessionId ? baseLabel : `${baseLabel} (next)`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-2 py-0.5 rounded bg-surface-2 border border-border-default text-fg-secondary hover:bg-hover-bg flex items-center gap-1"
        title={`Mode: ${statusLabel} (Ctrl+M)`}
      >
        <span>{statusLabel}</span>
        <span className="text-fg-muted" aria-hidden>
          +
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 bottom-full mb-1 w-64 bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 text-xs z-50"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-3 py-1 flex justify-between items-center text-fg-muted text-[11px] uppercase tracking-wider">
            <span>Mode</span>
            <span className="font-mono text-fg-muted flex items-center gap-1">
              <kbd className="px-1 border border-border-strong rounded">⇧</kbd>
              <kbd className="px-1 border border-border-strong rounded">Ctrl</kbd>
              <kbd className="px-1 border border-border-strong rounded">M</kbd>
            </span>
          </div>
          {MODE_ORDER.map((m, idx) => (
            <button
              key={m}
              type="button"
              onClick={() => void setMode(m)}
              className={`w-full text-left px-3 py-1 hover:bg-hover-bg flex items-center gap-2 ${
                current === m ? 'text-fg-primary' : 'text-fg-secondary'
              }`}
              title={MODE_DESCRIPTIONS[m]}
            >
              <span className="flex-1">{MODE_LABELS[m]}</span>
              {current === m && (
                <span className="text-ok" aria-hidden>
                  ✓
                </span>
              )}
              <span className="text-fg-muted text-[11px] font-mono w-3 text-right">{idx + 1}</span>
            </button>
          ))}

          {current === 'auto' && (
            <div className="border-t border-border-default mt-1 pt-1">
              <div className="px-3 py-1 text-fg-muted text-[11px] uppercase tracking-wider">
                Auto engine
              </div>
              {(['llm', 'rules'] as const).map((eng) => (
                <button
                  key={eng}
                  type="button"
                  onClick={() => void setEngine(eng)}
                  className={`w-full text-left px-3 py-1 hover:bg-hover-bg flex items-center gap-2 ${
                    engine === eng ? 'text-fg-primary' : 'text-fg-secondary'
                  }`}
                  title={ENGINE_DESCRIPTIONS[eng]}
                >
                  <span className="flex-1">{ENGINE_LABELS[eng]}</span>
                  {engine === eng && (
                    <span className="text-ok" aria-hidden>
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* 底部说明：Space Auto = KodaX guardrail；Claude Desktop "Bypass" 没有 1:1 对应 */}
          <div className="border-t border-border-default mt-1 pt-1 px-3 py-1 text-[11px] text-fg-muted leading-tight">
            Auto 由 KodaX guardrail 接管 — 比 Claude Desktop 的 Bypass 更安全
          </div>
        </div>
      )}
    </div>
  );
}
