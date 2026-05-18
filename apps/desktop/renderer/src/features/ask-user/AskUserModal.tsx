// AskUserModal — FEATURE_032
//
// 配合 KodaX AutoModeAskUser 接口的用户交互界面。
//
// 视觉与 PermissionModal 区分：
//   - PermissionModal 是"工具调用 gate"，每次 tool 触发一次，UI 突出 tool name + input
//   - AskUserModal 是"agent / guardrail 主动问"，频次低，UI 突出 reason 文本 +
//     可选 signals 标签 (FEATURE_158 Scope/Risk hints)
//
// Verdict 两选项：Allow / Block（与 KodaX AutoModeAskUserVerdict 严格对齐）。
// Escape = Block；Enter = Allow（保守默认是 Block，但 enter 不应该越权变 block —
// 用户常用回车确认 = allow 是直觉一致的）。
//
// 安全注意：
//   - reason / toolName / input 字段已在 main 端 sanitize；这里多加 truncate 防极端长 string
//   - signals 文本来自 KodaX 静态分析（trusted），但仍按 plain text 渲染防御 future 路径

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AskUserSignal, AskUserVerdict } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';

const SEVERITY_STYLE: Record<AskUserSignal['severity'], string> = {
  info: 'bg-blue-900 text-blue-200',
  warning: 'bg-amber-900 text-amber-200',
  danger: 'bg-red-900 text-red-100',
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function AskUserModal(): JSX.Element | null {
  const queue = useAppStore((s) => s.askUserQueue);
  const dequeue = useAppStore((s) => s.dequeueAskUser);
  const head = queue[0] ?? null;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBusy(false);
    setErr(null);
  }, [head?.reqId]);

  const inputPreview = useMemo(() => {
    if (!head?.toolCall.input) return null;
    try {
      return truncate(JSON.stringify(head.toolCall.input, null, 2), 2000);
    } catch {
      return '[unserializable input]';
    }
  }, [head]);

  const answer = useCallback(
    async (verdict: AskUserVerdict): Promise<void> => {
      if (!head || !window.kodaxSpace || busy) return;
      setBusy(true);
      setErr(null);
      try {
        const result = await window.kodaxSpace.invoke('askUser.reply', {
          reqId: head.reqId,
          verdict,
        });
        if (!result.ok) {
          // result.error 在 IpcResult union 类型上 ok=false 时存在；但 defensive 用 optional
          // chaining 防御未来 envelope shape 变化 / 异常路径 result.error 为 undefined
          const code = result.error?.code ?? 'ERR_UNKNOWN';
          const message = result.error?.message ?? 'unknown error';
          setErr(`${code}: ${message}`);
          setBusy(false);
          return;
        }
        // ok:true; data.ok 是 broker 端"该 reqId 还在 pending 吗"——晚到答案就当
        // dequeue 静默丢弃，视觉一致。
        dequeue(head.reqId);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    },
    [head, busy, dequeue],
  );

  useEffect(() => {
    if (!head) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        void answer('block');
      } else if (e.key === 'Enter' && !busy) {
        void answer('allow');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [head, busy, answer]);

  if (!head) return null;

  const hasDangerSignal = head.signals?.some((s) => s.severity === 'danger');
  const borderClass = hasDangerSignal ? 'border-red-700' : 'border-amber-700';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ask-user-modal-title"
    >
      <div className={`w-[560px] max-w-[95vw] max-h-[90vh] flex flex-col bg-zinc-900 border ${borderClass} rounded-lg shadow-xl`}>
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-3 flex-shrink-0">
          <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-amber-900 text-amber-200">
            ASK
          </span>
          <h2 id="ask-user-modal-title" className="text-sm font-semibold text-zinc-100">
            Agent needs your input
          </h2>
          {queue.length > 1 && (
            <span className="ml-auto text-[10px] font-mono text-zinc-500">
              +{queue.length - 1} pending
            </span>
          )}
        </div>

        <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
          <div className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">
            {truncate(head.reason, 1500)}
          </div>

          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase text-zinc-500">Tool</div>
            <div className="text-sm font-mono text-amber-300">{head.toolCall.toolName}</div>
          </div>

          {inputPreview && (
            <div className="space-y-1">
              <div className="text-[10px] font-mono uppercase text-zinc-500">Input</div>
              <pre className="text-[11px] font-mono bg-zinc-950 border border-zinc-800 rounded p-2 overflow-x-auto max-h-48">
                {inputPreview}
              </pre>
            </div>
          )}

          {head.signals && head.signals.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-mono uppercase text-zinc-500">Signals</div>
              <div className="flex flex-wrap gap-1">
                {head.signals.map((sig, idx) => (
                  <span
                    key={`${sig.type}-${idx}`}
                    className={`text-[10px] px-2 py-0.5 rounded font-mono ${SEVERITY_STYLE[sig.severity]}`}
                    title={sig.message}
                  >
                    {sig.type}
                  </span>
                ))}
              </div>
              {head.signals.map((sig, idx) => (
                <div key={`msg-${sig.type}-${idx}`} className="text-[11px] text-zinc-400 pl-2">
                  · {truncate(sig.message, 200)}
                </div>
              ))}
            </div>
          )}

          {err && <div className="text-xs text-red-400 font-mono">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2 flex-shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => void answer('block')}
            className="px-3 py-1.5 text-xs rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
          >
            Block (Esc)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void answer('allow')}
            className="px-3 py-1.5 text-xs rounded font-medium bg-emerald-700 text-zinc-100 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Allow (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}
