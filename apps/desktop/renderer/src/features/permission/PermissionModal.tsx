// PermissionModal —— F007 工具调用授权弹窗。
//
// 行为：
//   - 全局监听 push 'permission.request' / 'permission.cancelled'，进 store 的 permissionQueue
//   - 任一时刻只显示队列头部那个；用户决策后自动 dequeue 弹下一个
//   - 危险等级（risk='danger'）强制 typed-confirm：必须键入 CONFIRM 才能 enable Allow once
//     —— danger 永不出 "Always allow" 按钮（不该让危险命令静默白名单化）
//   - Escape = Deny；Enter（非危险时）= Allow once
//
// UX 历史：之前 "Always allow" 是 checkbox + 单 Allow 按钮，用户要先勾再点 —— 心智成本高。
// 现在改成 3 个按钮 (Deny / Allow once / Always allow `pattern`)，一键搞定。
//
// 安全注意：
//   - input 字段值原样 toString，不走 dangerouslySetInnerHTML——LLM 可能把 HTML 当做参数返回
//   - reason 字段已在 main 端限到 512 字；这里多套一层 truncate 防止极端长 string 撑爆 modal
//   - typed-confirm 比较用 trim() 后大小写敏感等值——避免 "Confirm" / " CONFIRM " 通过

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PermissionDecision,
  PermissionRisk,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';

// Risk badge 颜色. Dark 模式: 深色实底 + 淡色文字 (经典 badge 风);
// Light 模式: 淡色实底 + 深色文字 — 视觉等价倒置, 在白底卡片上仍清晰.
// border 双主题: dark 用同色相 *-700 (深色边); light 用 *-400 (中浓边, 跟浅底有反差).
const RISK_STYLE: Record<PermissionRisk, { badge: string; border: string; label: string }> = {
  low: {
    badge: 'dark:bg-blue-900 dark:text-blue-200 bg-blue-100 text-blue-900',
    border: 'dark:border-blue-700 border-blue-400',
    label: 'LOW',
  },
  medium: {
    badge: 'dark:bg-amber-900 dark:text-amber-200 bg-amber-100 text-amber-900',
    border: 'dark:border-amber-700 border-amber-400',
    label: 'MEDIUM',
  },
  high: {
    badge: 'dark:bg-orange-900 dark:text-orange-200 bg-orange-100 text-orange-900',
    border: 'dark:border-orange-700 border-orange-400',
    label: 'HIGH',
  },
  danger: {
    badge: 'dark:bg-red-900 dark:text-red-100 bg-red-100 text-red-900',
    border: 'dark:border-red-700 border-red-500',
    label: 'DANGER',
  },
};

const DANGER_CONFIRM_PHRASE = 'CONFIRM';

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function PermissionModal(): JSX.Element | null {
  const queue = useAppStore((s) => s.permissionQueue);
  const dequeue = useAppStore((s) => s.dequeuePermission);
  // FEATURE_032 fix: AskUserModal 渲染在 PermissionModal 之后（DOM 顺序晚 → z-stack 上层），
  // 当 askUserQueue 也非空时用户看到的是 AskUserModal——本 modal 应当 yield Esc / Enter
  // 给上层 modal 处理，避免一次 Esc 同时 dequeue 两个 modal head。
  const askUserActive = useAppStore((s) => s.askUserQueue.length > 0);
  const head = queue[0] ?? null;

  // 每次切换 head（新弹窗）重置本地状态
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setConfirmText('');
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

  // 提前算这些 derived state，answer/keydown 都要用
  const style = head ? RISK_STYLE[head.risk] : null;
  const isDanger = head?.risk === 'danger';
  const dangerConfirmed = !isDanger || confirmText.trim() === DANGER_CONFIRM_PHRASE;

  // review M3-code：用 useCallback 锁住 answer 的依赖关系，避免 keydown handler
  // 闭包陈旧的风险（queue shift 时仍调用陈旧 head 的 answer）
  const answer = useCallback(
    async (decision: PermissionDecision): Promise<void> => {
      if (!head || !window.kodaxSpace) return;
      if (busy) return;
      if (decision !== 'deny' && !dangerConfirmed) return;
      setBusy(true);
      setErr(null);
      try {
        // review C2-sec：不再发 pattern 字段——main 端用自己生成的 trustedPattern。
        // renderer 只能 toggle decision（deny / allow_once / allow_always）。
        // suggestedPattern 仍然存在但只用于 UI 显示（"Always allow bash:npm" 的文字）。
        const result = await window.kodaxSpace.invoke('permission.answer', {
          reqId: head.reqId,
          decision,
        });
        if (!result.ok) {
          // defensive (FEATURE_032 review): optional chaining 防 envelope error 字段缺失
          const code = result.error?.code ?? 'ERR_UNKNOWN';
          const message = result.error?.message ?? 'unknown error';
          setErr(`${code}: ${message}`);
          setBusy(false);
          return;
        }
        // result.data.accepted=false 表示 main 端已经把这条 reqId 撤回（超时 / session 取消）；
        // 视觉上同样 dequeue——弹窗已无意义
        dequeue(head.reqId);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    },
    [head, busy, dangerConfirmed, dequeue],
  );

  // Escape = deny；Enter = allow_once（仅非危险时）
  // 当 AskUserModal 同时可见时让出键盘——避免一次 Esc 同时 dequeue 双 modal head
  useEffect(() => {
    if (!head || askUserActive) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        void answer('deny');
      } else if (e.key === 'Enter' && head.risk !== 'danger' && !busy) {
        void answer('allow_once');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [head, busy, answer, askUserActive]);

  if (!head || !style) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-modal-title"
    >
      <div
        className={`w-[520px] max-w-[95vw] max-h-[90vh] flex flex-col bg-zinc-900 border ${style.border} rounded-lg shadow-xl`}
      >
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-3 flex-shrink-0">
          <span className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded ${style.badge}`}>
            {style.label}
          </span>
          <h2 id="permission-modal-title" className="text-sm font-semibold text-zinc-100">
            Tool 调用授权请求
          </h2>
          {queue.length > 1 && (
            <span className="ml-auto text-[10px] font-mono text-zinc-500">
              +{queue.length - 1} pending
            </span>
          )}
        </div>

        <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
          <div className="text-xs text-zinc-400 leading-relaxed">
            {truncate(head.reason, 256)}
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

          {isDanger && (
            <div className="space-y-1 border-t border-red-900 pt-3">
              <label className="text-[10px] font-mono uppercase text-red-300 block">
                Type "{DANGER_CONFIRM_PHRASE}" to enable allow
              </label>
              <input
                type="text"
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={DANGER_CONFIRM_PHRASE}
                className="w-full bg-zinc-950 border border-red-800 rounded px-2 py-1 text-sm font-mono text-zinc-100 outline-none focus:border-red-500"
              />
              <div className="text-[10px] text-red-400">
                检测到危险操作。必须键入确认字符串才能批准。
              </div>
            </div>
          )}

          {err && <div className="text-xs text-red-400 font-mono">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 dark:bg-transparent bg-zinc-50 flex items-center justify-end gap-2 flex-shrink-0 flex-wrap">
          <button
            type="button"
            disabled={busy}
            onClick={() => void answer('deny')}
            className="px-3 py-1.5 text-xs rounded dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 bg-zinc-200 text-zinc-800 hover:bg-zinc-300 disabled:opacity-50"
          >
            Deny (Esc)
          </button>
          {/* danger 永不出 Always allow——危险命令不能进白名单 */}
          {!isDanger && head.suggestedPattern && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void answer('allow_always')}
              title={`Add ${head.suggestedPattern} to allow-rules and skip prompt next time`}
              className="px-3 py-1.5 text-xs rounded font-medium border dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/30 border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Always allow{' '}
              <code className="font-mono text-[11px] dark:text-amber-300 text-amber-700">
                {head.suggestedPattern}
              </code>
            </button>
          )}
          <button
            type="button"
            disabled={busy || !dangerConfirmed}
            onClick={() => void answer('allow_once')}
            className={`px-3 py-1.5 text-xs rounded font-medium ${
              isDanger
                ? 'bg-red-700 text-zinc-100 hover:bg-red-600'
                : 'bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-700 dark:hover:bg-emerald-600'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isDanger ? 'Allow (danger)' : 'Allow once (Enter)'}
          </button>
        </div>
      </div>
    </div>
  );
}
