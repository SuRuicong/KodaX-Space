// F061 — Workflow 进度面板（Coder-only）。
//
// REPL inline/fullscreen 工作流面的 GUI 等价物：把 store 里某 session 的工作流 run 渲染成
// phase/agent/step 树，带 status 图标、counts/progress、token 用量、digest 三态。
// 纯展示——数据来自 F060 的 workflowRuns store slice；控制动作（stop/pause/resume）F062 接。
//
// Space 零编排：本组件只画 SDK 给的 snapshot，不跑、不折叠任何工作流逻辑。
//
// 结构（避免重复 selector + hooks-order 陷阱，记忆 leftsidebar_hooks_order_whitescreen）：
//   - useSessionWorkflowRuns()  —— 唯一 selector（useShallow 作元素级比较，跨 session 事件不误触发）
//   - WorkflowSection / 调用方  —— 调一次 selector，把 runs 当 prop 传下去
//   - WorkflowPanel({ runs })    —— 纯展示，不自取 store
//   - WorkflowPanelConnected     —— popout 用（自取 runs 再渲染 WorkflowPanel）

import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  CircleSlash,
  PauseCircle,
  Circle,
  MinusCircle,
  Bot,
  Coins,
  Pause,
  Play,
  Square,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Copy,
  type LucideIcon,
} from 'lucide-react';
import type {
  WorkflowRunT,
  WorkflowProcessStatusT,
  WorkflowProcessItemStatusT,
  WorkflowProcessSummaryStatusT,
  WorkflowActivityPayload,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { pushToast } from '../../store/toastStore.js';
import { buildItemTree, type WorkflowTreeNode } from './buildItemTree.js';
import { WorkflowRunGraph } from './WorkflowRunGraph.js';
import { WorkflowLauncher } from './WorkflowLauncher.js';
import { workflowPhaseCounter } from './workflowPhaseDisplay.js';

// ---- run / item 状态 → 图标 + 颜色 ----
const RUN_ICON: Record<WorkflowProcessStatusT, LucideIcon> = {
  running: Loader2,
  paused: PauseCircle,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: CircleSlash,
};
const RUN_COLOR: Record<WorkflowProcessStatusT, string> = {
  running: 'text-warn',
  paused: 'text-fg-muted',
  completed: 'text-ok',
  failed: 'text-danger',
  cancelled: 'text-fg-faint',
};
const ITEM_ICON: Record<WorkflowProcessItemStatusT, LucideIcon> = {
  pending: Circle,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: CircleSlash,
  skipped: MinusCircle,
};
const ITEM_COLOR: Record<WorkflowProcessItemStatusT, string> = {
  pending: 'text-fg-faint',
  running: 'text-warn',
  completed: 'text-ok',
  failed: 'text-danger',
  cancelled: 'text-fg-faint',
  skipped: 'text-fg-faint',
};
const SPIN: ReadonlySet<string> = new Set(['running']);
const TERMINAL: ReadonlySet<WorkflowProcessStatusT> = new Set(['completed', 'failed', 'cancelled']);
// 缩进每层 12px，但封顶 8 层——防 SDK 给深树时内层被推出面板（视觉饱和钳制）。
const MAX_INDENT_DEPTH = 8;

const EMPTY_RUNS: readonly WorkflowRunT[] = [];
const EMPTY_ACTIVITY: readonly WorkflowActivityPayload[] = [];

/**
 * fire-and-forget 控制调用：吞掉 IPC 拒绝（启动期无 handler / 通道未放行）避免 unhandled rejection；
 * 控制动作在 ok=false / 抛错时弹 toast。状态变化仍由 workflow.event 回流。
 */
function fireControl(p: Promise<unknown> | undefined, failMsg?: string): void {
  if (!p) return;
  void p
    .then((r) => {
      if (!failMsg) return;
      const env = r as { ok?: boolean; data?: { ok?: boolean } };
      if (env.ok === false || env.data?.ok === false) pushToast(failMsg, 'warning');
    })
    .catch(() => {
      if (failMsg) pushToast(failMsg, 'warning');
    });
}

/** 紧凑 token 格式：1234 → "1.2k"，1_200_000 → "1.2M"。 */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Selector：取归属 currentSession 的 run，按开始时间倒序（新的在前）。
 * useShallow 作元素级浅比较——workflowRuns 每个事件都换新引用（含别的 session 的事件），
 * 但只要本 session 的结果数组元素引用没变就不重渲染/重算（避免跨 session 事件误触发）。
 */
export function useSessionWorkflowRuns(): readonly WorkflowRunT[] {
  return useAppStore(
    useShallow((s) => {
      const sid = s.currentSessionId;
      if (!sid) return EMPTY_RUNS;
      return Object.values(s.workflowRuns)
        .filter((r) => r.sessionId === sid)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
    }),
  );
}

interface WorkflowPanelProps {
  /** 已 selector 出的 runs（由调用方传入，避免重复 selector）。 */
  readonly runs: readonly WorkflowRunT[];
  /** compact = RightSidebar 紧凑摘要（终态 run 折叠 tree）；full = popout 全展开。 */
  readonly variant?: 'compact' | 'full';
}

/** 纯展示面板：渲染传入的 runs。空 runs 显示空态（popout 路径可达）。 */
export function WorkflowPanel({ runs, variant = 'compact' }: WorkflowPanelProps): JSX.Element {
  if (runs.length === 0) {
    return <div className="text-xs text-fg-muted px-1 py-2">无工作流运行。</div>;
  }
  const visibleRuns = variant === 'compact' ? runs.slice(0, 3) : runs;
  const overflow = runs.length - visibleRuns.length;
  return (
    <div className="space-y-2">
      {visibleRuns.map((run) => (
        <WorkflowRunCard key={run.runId} run={run} variant={variant} />
      ))}
      {overflow > 0 && (
        <div className="text-[11px] text-fg-faint px-1 font-mono">
          +{overflow} more in full panel
        </div>
      )}
    </div>
  );
}

/** Popout 连接版：顶部启动器（F063）+ 当前 session 的 runs。 */
export function WorkflowPanelConnected({
  variant = 'full',
}: {
  variant?: 'compact' | 'full';
}): JSX.Element {
  const runs = useSessionWorkflowRuns();
  return (
    <div>
      <WorkflowLauncher />
      <WorkflowPanel runs={runs} variant={variant} />
    </div>
  );
}

// 头部控制簇：pause/resume/stop（按 status）+ rename（full）+ delete（终态 + full）。
// 控制后状态由 workflow.event 自然回流，按钮不乐观改本地态。
function WorkflowControls({
  run,
  variant,
  isTerminal,
  hasPhaseCounter,
  onRename,
}: {
  run: WorkflowRunT;
  variant: 'compact' | 'full';
  isTerminal: boolean;
  hasPhaseCounter: boolean;
  onRename: () => void;
}): JSX.Element {
  const runId = run.runId;
  const active = run.status === 'running' || run.status === 'paused';
  return (
    <div
      className={`flex items-center gap-0.5 flex-shrink-0 ${hasPhaseCounter ? 'ml-1.5' : 'ml-auto'}`}
    >
      {run.status === 'running' && (
        <CtlBtn
          label="暂停"
          onClick={() =>
            fireControl(window.kodaxSpace?.invoke('workflow.pause', { runId }), '暂停失败')
          }
        >
          <Pause size={12} />
        </CtlBtn>
      )}
      {run.status === 'paused' && (
        <CtlBtn
          label="恢复"
          onClick={() =>
            fireControl(window.kodaxSpace?.invoke('workflow.resume', { runId }), '恢复失败')
          }
        >
          <Play size={12} />
        </CtlBtn>
      )}
      {active && (
        <CtlBtn
          label="停止"
          danger
          onClick={() =>
            fireControl(window.kodaxSpace?.invoke('workflow.stop', { runId }), '停止失败')
          }
        >
          <Square size={12} />
        </CtlBtn>
      )}
      {variant === 'full' && (
        <CtlBtn label="重命名" onClick={onRename}>
          <Pencil size={11} />
        </CtlBtn>
      )}
      {variant === 'full' && isTerminal && (
        <CtlBtn
          label="删除"
          danger
          onClick={() => {
            if (window.confirm(`删除工作流 run「${run.displayName ?? run.workflowName}」？`)) {
              fireControl(window.kodaxSpace?.invoke('workflow.delete', { runId }), '删除失败');
            }
          }}
        >
          <Trash2 size={11} />
        </CtlBtn>
      )}
    </div>
  );
}

function CtlBtn({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`w-5 h-5 inline-flex items-center justify-center rounded text-fg-muted hover:bg-surface-3 ${
        danger ? 'hover:text-danger' : 'hover:text-fg-primary'
      }`}
    >
      {children}
    </button>
  );
}

function WorkflowRunCard({
  run,
  variant,
}: {
  run: WorkflowRunT;
  variant: 'compact' | 'full';
}): JSX.Element {
  const RunIcon = RUN_ICON[run.status];
  const tree = useMemo(() => buildItemTree(run.items), [run.items]);
  const isTerminal = TERMINAL.has(run.status);
  const [detailsOpen, setDetailsOpen] = useState(variant === 'full');
  const showTree = variant === 'full' || detailsOpen;
  const tokenPct =
    run.tokens?.total && run.tokens.total > 0
      ? Math.min(100, (run.tokens.spent / run.tokens.total) * 100)
      : null;
  const phaseCounter = workflowPhaseCounter(run);

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  // 防双触发:Enter 提交后 setRenaming(false) 卸载 input → 触发 blur 又调一次 commitRename。
  // ref 跨 Enter+blur 序列守一次（state 重置在同事件内读不到，必须用 ref）。
  const committingRef = useRef(false);
  const name = run.displayName ?? run.workflowName;
  function startRename(): void {
    committingRef.current = false;
    setDraft(name);
    setRenaming(true);
  }
  function commitRename(): void {
    if (committingRef.current) return;
    committingRef.current = true;
    const next = draft.trim();
    setRenaming(false);
    if (next && next !== name) {
      fireControl(
        window.kodaxSpace?.invoke('workflow.rename', { runId: run.runId, displayName: next }),
        '重命名失败',
      );
    }
  }

  return (
    <div className="rounded-lg border border-border-default/70 bg-surface-2 p-2">
      {/* 头部：状态图标 + 名称（可改名）+ phase 进度 + 控制 */}
      <div className="flex items-center gap-1.5 min-w-0">
        <RunIcon
          size={13}
          className={`flex-shrink-0 ${RUN_COLOR[run.status]} ${SPIN.has(run.status) ? 'animate-spin' : ''}`}
          aria-hidden
        />
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setRenaming(false);
            }}
            className="flex-1 min-w-0 text-[12px] bg-surface-3 border border-border-default rounded px-1 py-0.5 text-fg-primary"
            aria-label="重命名工作流"
          />
        ) : (
          <span className="text-[12px] font-medium text-fg-primary truncate" title={name}>
            {name}
          </span>
        )}
        {phaseCounter !== undefined && !renaming && (
          <span className="ml-auto flex-shrink-0 text-[10px] font-mono text-fg-muted">
            {phaseCounter}
          </span>
        )}
        {!renaming && (
          <WorkflowControls
            run={run}
            variant={variant}
            isTerminal={isTerminal}
            hasPhaseCounter={phaseCounter !== undefined}
            onRename={startRename}
          />
        )}
      </div>

      {/* 进度计量行：agents + token */}
      <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-fg-muted">
        <span className="inline-flex items-center gap-1" title="agents：完成/已生成（活跃）">
          <Bot size={10} aria-hidden />
          {run.progress.finishedAgents}/{run.progress.spawnedAgents}
          {run.progress.activeAgents > 0 && (
            <span className="text-warn">·{run.progress.activeAgents}</span>
          )}
        </span>
        {run.tokens && (
          <span className="inline-flex items-center gap-1" title="token：已花/预算">
            <Coins size={10} aria-hidden />
            {fmtTokens(run.tokens.spent)}
            {run.tokens.total ? `/${fmtTokens(run.tokens.total)}` : ''}
          </span>
        )}
        {run.counts.failed > 0 && <span className="text-danger">✗ {run.counts.failed}</span>}
      </div>
      {tokenPct !== null && (
        <div className="mt-1 h-0.5 bg-surface-3 rounded overflow-hidden">
          <div
            className={`h-full ${tokenPct > 90 ? 'bg-danger' : 'bg-ok'}`}
            style={{ width: `${tokenPct}%` }}
          />
        </div>
      )}

      {/* 最新活动行 */}
      {run.latestMessage && !isTerminal && (
        <div className="mt-1 text-[11px] text-fg-secondary truncate" title={run.latestMessage}>
          {run.latestMessage}
        </div>
      )}

      <WorkflowRunGraph run={run} variant={variant} />

      {variant === 'compact' && (tree.length > 0 || !isTerminal) && (
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg-primary"
          aria-expanded={detailsOpen}
        >
          {detailsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Subagents
        </button>
      )}

      {/* 结果 / 错误（终态） */}
      {run.status === 'failed' && run.error && (
        <div className="mt-1 text-[11px] text-danger break-words">{run.error}</div>
      )}
      {run.resultSummary && isTerminal && (
        <div className="mt-1 text-[11px] text-fg-secondary break-words">{run.resultSummary}</div>
      )}

      {/* F066 完整结果（终态懒取）；artifacts 已自动桥进 artifact 面板（方案 A）。 */}
      {isTerminal && run.status === 'completed' && <WorkflowResultView runId={run.runId} />}

      {/* item 树 */}
      {showTree && tree.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {tree.map((node) => (
            <WorkflowItemRow key={node.item.id} node={node} depth={0} />
          ))}
        </ul>
      )}

      {/* F065 子 agent 活动遥测（活跃 / full 时显示，不淹主 transcript） */}
      {showTree && <WorkflowActivityStrip runId={run.runId} />}
    </div>
  );
}

/** F066 完整结果视图：终态懒取 workflow.result，可展开 + 复制。 */
function WorkflowResultView({ runId }: { runId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => void (mountedRef.current = false), []);
  async function toggle(): Promise<void> {
    const next = !open;
    setOpen(next);
    if (next && result === null) {
      setLoading(true);
      const r = await window.kodaxSpace?.invoke('workflow.result', { runId }).catch(() => null);
      if (!mountedRef.current) return; // 卸载后不再 setState
      setResult(r?.ok ? (r.data.result ?? '') : '');
      setLoading(false);
    }
  }
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => void toggle()}
        className="inline-flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg-primary"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        完整结果
      </button>
      {open && (
        <div className="mt-1">
          {loading ? (
            <div className="text-[10px] text-fg-faint">加载中…</div>
          ) : result ? (
            <div className="relative">
              <pre className="max-h-48 overflow-auto rounded bg-surface-3 p-1.5 text-[10px] text-fg-secondary whitespace-pre-wrap break-words">
                {result}
              </pre>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(result)
                    .then(() => pushToast('已复制结果', 'success'))
                }
                title="复制"
                aria-label="复制结果"
                className="absolute top-1 right-1 w-5 h-5 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-2"
              >
                <Copy size={11} />
              </button>
            </div>
          ) : (
            <div className="text-[10px] text-fg-faint">无结果内容。</div>
          )}
        </div>
      )}
    </div>
  );
}

const ACTIVITY_ICON: Record<WorkflowActivityPayload['kind'], string> = {
  tool_use: '▸',
  tool_result: '✓',
  end: '■',
};
const ACTIVITY_WINDOW = 6;

/** 子 agent 活动条：显示最近几条 discrete 活动（工具调用/结果/封口），按子 agent 标注。 */
function WorkflowActivityStrip({ runId }: { runId: string }): JSX.Element | null {
  const activity = useAppStore(useShallow((s) => s.workflowActivityByRun[runId] ?? EMPTY_ACTIVITY));
  if (activity.length === 0) return null;
  // 用 bucket 内绝对位置作 key——滑动窗口下保持稳定（不随 slice 起点漂移）。
  const base = Math.max(0, activity.length - ACTIVITY_WINDOW);
  const recent = activity.slice(base);
  return (
    <div className="mt-1.5 border-t border-border-default/40 pt-1 space-y-0.5">
      {recent.map((a, i) => (
        <div
          key={`${a.runId}-${base + i}`}
          className="flex items-center gap-1.5 text-[10px] text-fg-muted min-w-0"
        >
          <span className="text-fg-faint flex-shrink-0">{ACTIVITY_ICON[a.kind]}</span>
          {a.childAgentName && (
            <span className="text-fg-faint flex-shrink-0 max-w-[90px] truncate">
              {a.childAgentName}
            </span>
          )}
          <span className="truncate">{a.kind === 'end' ? '完成' : (a.toolName ?? a.kind)}</span>
        </div>
      ))}
    </div>
  );
}

function WorkflowItemRow({ node, depth }: { node: WorkflowTreeNode; depth: number }): JSX.Element {
  const { item, children } = node;
  const Icon = ITEM_ICON[item.status];
  const indentPx = Math.min(depth, MAX_INDENT_DEPTH) * 12;
  return (
    <li>
      <div
        className="flex items-center gap-1.5 text-[11px] min-w-0"
        style={{ paddingLeft: `${indentPx}px` }}
      >
        <Icon
          size={11}
          className={`flex-shrink-0 ${ITEM_COLOR[item.status]} ${SPIN.has(item.status) ? 'animate-spin' : ''}`}
          aria-hidden
        />
        <span
          className={`truncate ${item.status === 'running' ? 'text-fg-primary' : 'text-fg-secondary'}`}
          title={item.title}
        >
          {item.title || item.id}
        </span>
        {item.model && (
          <span
            className="ml-auto flex-shrink-0 text-[9px] font-mono text-fg-faint truncate max-w-[80px]"
            title={`${item.provider ?? ''} ${item.model}`}
          >
            {item.model}
          </span>
        )}
      </div>
      {/* digest 三态：result/notice 显文本 / pending 显生成中 / unavailable 诚实标不可用 */}
      {item.summaryStatus !== undefined && (
        <DigestLine status={item.summaryStatus} summary={item.summary} indentPx={indentPx} />
      )}
      {children.length > 0 && (
        <ul className="space-y-0.5">
          {children.map((c) => (
            <WorkflowItemRow key={c.item.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function DigestLine({
  status,
  summary,
  indentPx,
}: {
  status: WorkflowProcessSummaryStatusT;
  summary?: string;
  indentPx: number;
}): JSX.Element | null {
  const pad = { paddingLeft: `${indentPx + 16}px` };
  switch (status) {
    case 'pending':
      return (
        <div className="text-[10px] text-fg-faint italic" style={pad}>
          生成摘要中…
        </div>
      );
    case 'unavailable':
      return (
        <div className="text-[10px] text-fg-faint italic" style={pad}>
          摘要不可用，见原始结果
        </div>
      );
    case 'notice':
      // 非最终摘要的提示性信息——与 result 区分：弱化 + 前缀标记。
      if (!summary) return null;
      return (
        <div className="text-[10px] text-fg-faint break-words" style={pad} title={summary}>
          ⓘ {summary}
        </div>
      );
    case 'result':
      if (!summary) return null;
      return (
        <div className="text-[10px] text-fg-muted break-words" style={pad} title={summary}>
          {summary}
        </div>
      );
    default:
      // 穷尽性保险：SDK 若加新 summaryStatus，编译期会在此报错。
      return assertNever(status);
  }
}

function assertNever(x: never): null {
  void x;
  return null;
}
