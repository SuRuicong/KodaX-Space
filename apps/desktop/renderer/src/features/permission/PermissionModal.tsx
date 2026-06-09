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
  PermissionRequestPayload,
  PermissionRisk,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { selectPermissionBatch } from './permissionBatching.js';

// Risk badge 颜色. Dark 模式: 深色实底 + 淡色文字 (经典 badge 风);
// Light 模式: 淡色实底 + 深色文字 — 视觉等价倒置, 在白底卡片上仍清晰.
// border 双主题: dark 用同色相 *-700 (深色边); light 用 *-400 (中浓边, 跟浅底有反差).
const RISK_STYLE: Record<PermissionRisk, { badge: string; border: string; label: string }> = {
  low: {
    badge: 'bg-info/12 text-info',
    border: 'border-info/40',
    label: 'LOW',
  },
  medium: {
    badge: 'bg-warn/12 text-warn',
    border: 'border-warn/40',
    label: 'MEDIUM',
  },
  high: {
    badge: 'bg-warn/12 text-warn',
    border: 'border-warn/40',
    label: 'HIGH',
  },
  danger: {
    badge: 'bg-danger/12 text-danger',
    border: 'border-danger/40',
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
  // KX-I-05: queue 头部"同 session + 非 danger"连续 ≥ 2 条时合并成 batch 视图。
  const selection = useMemo(() => selectPermissionBatch(queue), [queue]);
  const head = selection.mode === 'single' ? selection.head : selection.items[0]!;

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
  // KX-I-05 LOW 修：batch 模式下让 PermissionBatchView 独占键盘，否则 Esc 会同时 fire
  // 这里的 single answer(head, 'deny') + 那边的 answerAll('deny') 导致 head 双 IPC。
  useEffect(() => {
    if (!head || askUserActive || selection.mode === 'batch') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        void answer('deny');
      } else if (e.key === 'Enter' && head.risk !== 'danger' && !busy) {
        void answer('allow_once');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [head, busy, answer, askUserActive, selection.mode]);

  if (!head || !style) return null;

  // KX-I-05 batch view 分支：N 个连续同 session 非 danger 请求一次决策
  if (selection.mode === 'batch') {
    return (
      <PermissionBatchView
        items={selection.items}
        askUserActive={askUserActive}
        dequeue={dequeue}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-modal-title"
    >
      <div
        className={`w-[520px] max-w-[95vw] max-h-[90vh] flex flex-col bg-surface-2 border ${style.border} rounded-lg shadow-xl`}
      >
        <div className="px-5 py-3 border-b border-border-default flex items-center gap-3 flex-shrink-0">
          <span
            className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded ${style.badge}`}
          >
            {style.label}
          </span>
          <h2 id="permission-modal-title" className="text-sm font-semibold text-fg-primary">
            Tool 调用授权请求
          </h2>
          {queue.length > 1 && (
            <span className="ml-auto text-[11px] font-mono text-fg-muted">
              +{queue.length - 1} pending
            </span>
          )}
        </div>

        <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
          <div className="text-xs text-fg-muted leading-relaxed">{truncate(head.reason, 256)}</div>

          <div className="space-y-1">
            <div className="text-[11px] font-mono uppercase text-fg-muted">Tool</div>
            <div className="text-sm font-mono text-warn">{head.toolCall.toolName}</div>
          </div>

          {inputPreview && (
            <div className="space-y-1">
              <div className="text-[11px] font-mono uppercase text-fg-muted">Input</div>
              <pre className="text-xs font-mono bg-surface border border-border-default rounded p-2 overflow-x-auto max-h-48">
                {inputPreview}
              </pre>
            </div>
          )}

          {isDanger && (
            <div className="space-y-1 border-t border-danger pt-3">
              <label className="text-[11px] font-mono uppercase text-danger block">
                Type "{DANGER_CONFIRM_PHRASE}" to enable allow
              </label>
              <input
                type="text"
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={DANGER_CONFIRM_PHRASE}
                className="w-full bg-surface border border-danger rounded px-2 py-1 text-sm font-mono text-fg-primary outline-none focus:border-danger"
              />
              <div className="text-[11px] text-danger">
                检测到危险操作。必须键入确认字符串才能批准。
              </div>
            </div>
          )}

          {err && <div className="text-xs text-danger font-mono">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-border-default dark:bg-transparent bg-surface flex items-center justify-end gap-2 flex-shrink-0 flex-wrap">
          <button
            type="button"
            disabled={busy}
            onClick={() => void answer('deny')}
            className="px-3 py-1.5 text-xs rounded dark:bg-surface-3 dark:text-fg-primary dark:hover:bg-hover-bg bg-surface-3 text-fg-secondary hover:bg-hover-bg disabled:opacity-50"
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
              className="px-3 py-1.5 text-xs rounded font-medium border border-ok text-ok hover:bg-ok/15 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Always allow{' '}
              <code className="font-mono text-xs text-warn">{head.suggestedPattern}</code>
            </button>
          )}
          <button
            type="button"
            disabled={busy || !dangerConfirmed}
            onClick={() => void answer('allow_once')}
            className={`px-3 py-1.5 text-xs rounded font-medium ${
              isDanger
                ? 'bg-danger/15 text-danger border border-danger/50 hover:bg-danger/25'
                : 'bg-ok/15 text-ok border border-ok/50 hover:bg-ok/25'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isDanger ? 'Allow (danger)' : 'Allow once (Enter)'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- KX-I-05 PermissionBatchView ----
//
// 同 session 连续 ≥ 2 条非 danger 请求合并显示。提供 batch 顶部操作（Allow all/Deny all）
// + 每条独立按钮兜底。Esc=Deny all, Enter=Allow all once。danger 永远不入 batch。

interface PermissionBatchViewProps {
  readonly items: readonly PermissionRequestPayload[];
  readonly askUserActive: boolean;
  readonly dequeue: (reqId: string) => void;
}

function PermissionBatchView({
  items,
  askUserActive,
  dequeue,
}: PermissionBatchViewProps): JSX.Element {
  // 用 items 里 highest risk 决定外层 badge 颜色
  const maxRisk: PermissionRisk = useMemo(() => {
    const order: PermissionRisk[] = ['low', 'medium', 'high'];
    let m: PermissionRisk = 'low';
    for (const it of items) {
      if (order.indexOf(it.risk) > order.indexOf(m)) m = it.risk;
    }
    return m;
  }, [items]);
  const style = RISK_STYLE[maxRisk];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const answerOne = useCallback(
    async (reqId: string, decision: PermissionDecision): Promise<void> => {
      if (!window.kodaxSpace) return;
      const r = await window.kodaxSpace.invoke('permission.answer', { reqId, decision });
      if (!r.ok) {
        setErr(`${r.error?.code ?? 'ERR'}: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      dequeue(reqId);
    },
    [dequeue],
  );

  const answerAll = useCallback(
    async (decision: PermissionDecision): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setErr(null);
      // 并发发 N 条 — main 端 broker 各自 resolve，dequeue 各自更新。
      // review HIGH 修：try/finally 保证 busy 一定回归 false。
      // 否则 IPC 层 throw（channel closed / preload 缺失）会让 Promise.all reject，
      // setBusy(false) 永远不跑，整个 batch modal 卡死直到 session 结束。
      try {
        const reqIds = items.map((i) => i.reqId);
        await Promise.all(reqIds.map((id) => answerOne(id, decision)));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, items, answerOne],
  );

  // 键盘：Esc=Deny all, Enter=Allow all once
  useEffect(() => {
    if (askUserActive) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        void answerAll('deny');
      } else if (e.key === 'Enter' && !busy) {
        void answerAll('allow_once');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, answerAll, askUserActive]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-batch-title"
    >
      <div
        className={`w-[620px] max-w-[95vw] max-h-[90vh] flex flex-col bg-surface-2 border ${style.border} rounded-lg shadow-xl`}
      >
        <div className="px-5 py-3 border-b border-border-default flex items-center gap-3 flex-shrink-0">
          <span
            className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded ${style.badge}`}
          >
            {style.label}
          </span>
          <h2 id="permission-batch-title" className="text-sm font-semibold text-fg-primary">
            {items.length} tool calls pending — batch decision
          </h2>
        </div>

        <div className="px-5 py-3 flex-1 overflow-y-auto space-y-2">
          {items.map((it) => (
            <div
              key={it.reqId}
              className="flex items-center gap-2 border border-border-default rounded px-3 py-2 hover:bg-hover-bg"
            >
              <span
                className={`px-1.5 py-0.5 text-[9px] font-mono font-semibold rounded ${RISK_STYLE[it.risk].badge}`}
                title={`Risk: ${it.risk}`}
              >
                {RISK_STYLE[it.risk].label}
              </span>
              <span className="text-xs font-mono text-warn flex-shrink-0">
                {it.toolCall.toolName}
              </span>
              <span className="text-xs text-fg-muted truncate flex-1" title={it.reason}>
                {truncate(it.reason, 100)}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void answerOne(it.reqId, 'deny')}
                className="px-2 py-0.5 text-xs rounded dark:bg-surface-3 dark:text-fg-primary dark:hover:bg-hover-bg bg-surface-3 text-fg-secondary hover:bg-hover-bg disabled:opacity-50"
              >
                Deny
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void answerOne(it.reqId, 'allow_once')}
                className="px-2 py-0.5 text-xs rounded font-medium bg-ok/15 text-ok border border-ok/50 hover:bg-ok/25 disabled:opacity-50"
              >
                Allow
              </button>
            </div>
          ))}
          {err && <div className="text-xs text-danger font-mono">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-border-default dark:bg-transparent bg-surface flex items-center justify-end gap-2 flex-shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => void answerAll('deny')}
            className="px-3 py-1.5 text-xs rounded dark:bg-surface-3 dark:text-fg-primary dark:hover:bg-hover-bg bg-surface-3 text-fg-secondary hover:bg-hover-bg disabled:opacity-50"
          >
            Deny all ({items.length}) <span className="ml-1 text-fg-muted">Esc</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void answerAll('allow_once')}
            className="px-3 py-1.5 text-xs rounded font-medium bg-ok/15 text-ok border border-ok/50 hover:bg-ok/25 disabled:opacity-50"
          >
            Allow all once ({items.length}) <span className="ml-1 text-ok/70">Enter</span>
          </button>
        </div>
      </div>
    </div>
  );
}
