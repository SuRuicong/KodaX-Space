// Bubble + ToolCallCard + SystemNotice 组件集合。
// 单文件聚合：每个组件 < 80 行，共享 ConversationMessage 类型，拆分反而提高复杂度。

import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { ConversationMessage } from '../composeMessages.js';
import { Markdown } from './Markdown.js';
import { Caret } from '../../../components/Caret.js';
// OC-21: side-effect import 让内置 tool renderers (write/edit/multi_edit) 注册到 registry
import './toolRenderers.js';
import { getToolInputRenderer, getToolResultRenderer } from './toolRegistry.js';

// ---- P4c: tool result 收窄渲染 ----

const DIFF_MIDDLE_COLLAPSE_LINES = 16;
const DIFF_HEAD_TAIL_LINES = 8;
const NORMAL_MIDDLE_COLLAPSE_LINES = 32;
const NORMAL_HEAD_TAIL_LINES = 5;
/** 超过此行数：极端守门 — 只显示头 5 行 + N 行折叠，不做对称的尾巴避免拉爆视窗。*/
const EXTREME_LINE_THRESHOLD = 200;
const EXTREME_HEAD_LINES = 5;

/**
 * 粗略估算 token 数——renderer 拿不到真 tokenizer，给个跟人类直觉对得上的近似：
 *   - ASCII (英文 / 数字 / 标点)：每 4 chars ≈ 1 token（GPT/Claude BPE 经验值）
 *   - 其他 (中文/日文/韩文/emoji 等)：每字符 ≈ 1 token（CJK 字符通常单独成 token）
 * 误差通常在 ±20%，对 Thinking 段长度感知足够。
 */
function approxTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else nonAscii++;
  }
  return Math.max(1, Math.round(ascii / 4 + nonAscii));
}

function isDiffLike(text: string): boolean {
  // 启发式：unified diff 必含 "@@ " hunk 头，或 >40% 行以 +/- 起头（排除 ---/+++ 头部
  // 与 "- " 这种 markdown bullet / "  - " yaml 列表项 → 通常列表也是 dash-space，但
  // 真实 diff 的 -/+ 后多直接跟代码字符，少见空格）。0.4 比 0.3 抗"shell log 列表型输出"的
  // false-positive 更稳。
  if (text.includes('\n@@ ') || text.startsWith('@@ ')) return true;
  const lines = text.split('\n');
  if (lines.length < 4) return false;
  let diffLines = 0;
  for (const l of lines) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    // "+ " / "- " 前缀通常是 markdown / shell log，不视为 diff
    if (l.startsWith('+ ') || l.startsWith('- ')) continue;
    if (l.startsWith('+') || l.startsWith('-')) diffLines++;
  }
  return diffLines / lines.length > 0.4;
}

interface CollapseResult {
  body: string;
  collapsed: boolean;
  /** 极端守门触发；renderer 可考虑禁用 "show full" 钮 */
  extreme: boolean;
  totalLines: number;
}

function collapseLargeText(text: string): CollapseResult {
  const lines = text.split('\n');
  const total = lines.length;
  const isDiff = isDiffLike(text);
  const threshold = isDiff ? DIFF_MIDDLE_COLLAPSE_LINES : NORMAL_MIDDLE_COLLAPSE_LINES;
  if (total <= threshold) {
    return { body: text, collapsed: false, extreme: false, totalLines: total };
  }
  if (total > EXTREME_LINE_THRESHOLD) {
    const head = lines.slice(0, EXTREME_HEAD_LINES).join('\n');
    const omitted = total - EXTREME_HEAD_LINES;
    return {
      body: `${head}\n…(${omitted} more lines — extremely large, click "Show full" to see)`,
      collapsed: true,
      extreme: true,
      totalLines: total,
    };
  }
  const headN = isDiff ? DIFF_HEAD_TAIL_LINES : NORMAL_HEAD_TAIL_LINES;
  const tailN = headN;
  const head = lines.slice(0, headN).join('\n');
  const tail = lines.slice(-tailN).join('\n');
  const omitted = total - headN - tailN;
  return {
    body: `${head}\n…(${omitted} lines collapsed)…\n${tail}`,
    collapsed: true,
    extreme: false,
    totalLines: total,
  };
}

// ---- Message footer (copy + relative time) ----
//
// 替代之前的 "✓ complete" 横条——视觉更轻，对每个 user/assistant message 都挂一个
// 尾巴：[复制 icon] + "Xd ago"。hover bubble 时显示，非 hover 时 dim 或隐藏避免视觉
// 噪音。Claude Desktop 同款风格。
function MessageFooter({ text, sentAt }: { text: string; sentAt?: number }): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 极少数情况 clipboard API 不可用——静默失败，不打扰用户
    }
  }

  const timeStr = sentAt !== undefined ? formatRelativeTime(sentAt) : null;

  // 时间 + copy 图标都常驻显示 (dim)；hover copy 按钮时图标右边淡入 "copy" 文字
  // (group/copy 限制 hover 作用域到本按钮，避免 message bubble 整体 hover 时一直显示)。
  // 这样用户一眼看见两个 affordance，不再需要鼠标先找到 bubble 才知道有 copy 可用。
  return (
    <div className="mt-1 flex items-center gap-2 text-[11px]">
      <button
        type="button"
        onClick={() => void copyToClipboard()}
        className="group/copy flex items-center gap-1 text-fg-muted hover:text-fg-primary transition-colors"
        title="Copy message"
        aria-label="Copy message"
      >
        {copied ? (
          <span className="text-ok inline-flex items-center gap-1">
            <Check className="w-3 h-3" strokeWidth={2.5} aria-hidden /> copied
          </span>
        ) : (
          <>
            {/* Lucide-style copy icon — 之前用的 Unicode ⎘ (U+2398) 在多数字体里
                几乎看不见 (用户反馈"不显眼")，换成内联 SVG 在所有字体下都清晰。
                stroke=currentColor 让浅/深主题都跟随 text color。 */}
            <svg
              aria-hidden
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="14" height="14" x="8" y="8" rx="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            <span className="opacity-0 max-w-0 overflow-hidden group-hover/copy:opacity-100 group-hover/copy:max-w-[40px] transition-all duration-150">
              copy
            </span>
          </>
        )}
      </button>
      {timeStr && (
        <span className="text-fg-muted" title={new Date(sentAt!).toLocaleString()}>
          {timeStr}
        </span>
      )}
    </div>
  );
}

/**
 * 相对时间格式：~now / 5m ago / 2h ago / 3d ago / 2w ago / 4mo ago / 1y ago
 * 跟 Claude Desktop 同款"短英文"风格，避免本地化里中英混杂。
 */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 30) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(d / 365);
  return `${y}y ago`;
}

// ---- User Bubble ----

export function UserBubble({ content, sentAt }: { content: string; sentAt?: number }): JSX.Element {
  // Claude Desktop 风格 ——「对话即文档」单列布局：user pill **左对齐**与 assistant
  // 同列，浅蓝窄底色、收宽到 max-w-[80%]、width 跟内容走 (inline-block) 不撑满。
  // 这样比之前 80% 右对齐蓝 bubble 视觉更克制，整体读起来像一段文档流。
  return (
    <div className="group flex flex-col items-start">
      <div
        className={[
          'inline-block max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px] whitespace-pre-wrap border',
          'dark:bg-blue-900/25 dark:border-blue-800/40 dark:text-blue-100',
          'bg-blue-50 border-blue-200 text-blue-900',
        ].join(' ')}
      >
        {content}
      </div>
      <MessageFooter text={content} sentAt={sentAt} />
    </div>
  );
}

// ---- Assistant Bubble (markdown + 可选 thinking) ----

export function AssistantBubble({
  text,
  thinking,
  sentAt,
}: {
  text: string;
  thinking?: string;
  sentAt?: number;
}): JSX.Element {
  const [showThinking, setShowThinking] = useState(false);
  // 「对话即文档」—— assistant 不包 bubble，直接 markdown 进入文档流。
  // thinking 改成一行折叠摘要 (▸ Thinking (~N tokens))，跟外层 ToolCluster header 视觉一致。
  return (
    <div className="group">
      {thinking !== undefined && (
        <button
          type="button"
          onClick={() => setShowThinking((v) => !v)}
          className={[
            'text-xs font-mono mb-1.5 flex items-center gap-1.5',
            'dark:text-purple-400 dark:hover:text-purple-300',
            'text-purple-700 hover:text-purple-900',
          ].join(' ')}
        >
          <Caret open={showThinking} />
          <span>Thinking (~{approxTokens(thinking)} tokens)</span>
        </button>
      )}
      {showThinking && thinking !== undefined && (
        <div
          className={[
            'mb-2 ml-3 pl-2 border-l text-xs whitespace-pre-wrap',
            'dark:border-purple-900/60 dark:text-purple-300/80',
            'border-purple-200 text-purple-800',
          ].join(' ')}
        >
          {thinking}
        </div>
      )}
      <div className="text-sm leading-relaxed dark:text-fg-primary text-fg-primary">
        {text.length > 0 ? (
          <Markdown content={text} />
        ) : (
          <span className="dark:text-fg-faint text-fg-muted italic">…</span>
        )}
      </div>
      {text.length > 0 && <MessageFooter text={text} sentAt={sentAt} />}
    </div>
  );
}

// ---- Tool Call Card ----

// Card body 颜色按**状态**而非工具种类决定 —— 用户反馈：bash done 还显示浅红色
// 与 DONE 浅绿标签矛盾。红色全局语义=错误，不应当作 bash 的常态色。
// 状态主导后 done=emerald / running=amber，跟 DONE 徽章语义一致。
const TOOL_STATUS_COLOR: Record<'running' | 'done', string> = {
  running: 'dark:border-amber-800/30 dark:bg-amber-950/20 border-amber-200 bg-amber-50/70',
  done: 'dark:border-emerald-800/30 dark:bg-emerald-950/20 border-emerald-200 bg-emerald-50/70',
};

// 工具种类色相留在 tool name 文字上 —— 用户仍能一眼分清工具类型，但不再霸占 body。
// 注意：bash 不用 red (语义=错误)，改 rose 表达"powerful + 注意"。
const TOOL_NAME_COLOR: Record<string, string> = {
  read: 'dark:text-blue-300 text-blue-700',
  write: 'dark:text-amber-300 text-amber-700',
  edit: 'dark:text-amber-300 text-amber-700',
  multi_edit: 'dark:text-amber-300 text-amber-700',
  bash: 'dark:text-rose-300 text-rose-700',
  grep: 'dark:text-emerald-300 text-emerald-700',
  glob: 'dark:text-emerald-300 text-emerald-700',
};

// v0.1.9 fix: 文件修改类工具默认展开 — 用户期望对话流里直接看到 diff 摘要 (path + ±N),
// 不用再点一次卡片才看到。其它工具 (bash / grep / read 等) 保持默认折叠避免噪音。
// ToolDiffView 自己还有第二层折叠 — Monaco 大块 viewer 仍点开才加载,不影响性能。
const FILE_MUTATION_TOOLS_DEFAULT_EXPANDED: ReadonlySet<string> = new Set([
  'write',
  'edit',
  'multi_edit',
  'str_replace',
  'insert_after_anchor',
]);

export function ToolCallCard({
  toolName,
  input,
  result,
  progress,
  status,
}: Extract<ConversationMessage, { kind: 'tool_call' }>): JSX.Element {
  const [expanded, setExpanded] = useState(() =>
    FILE_MUTATION_TOOLS_DEFAULT_EXPANDED.has(toolName),
  );
  const [showFullResult, setShowFullResult] = useState(false);
  // showFullInput / inputPretty / inputCollapse 状态已搬进 ToolEditInputView —
  // OC-21 之后 raw-JSON fallback 由那边统一处理
  const colorClass = TOOL_STATUS_COLOR[status] ?? 'border-border-strong bg-surface-2/50';
  const toolNameColor = TOOL_NAME_COLOR[toolName] ?? 'text-fg-secondary';
  const argSummary = summarizeInput(input);

  // P4c: result 走行级折叠（diff middle-collapse / 极端守门）
  const resultCollapse = useMemo<CollapseResult | null>(() => {
    if (result === undefined) return null;
    return collapseLargeText(result);
  }, [result]);

  return (
    <div className={`rounded border ${colorClass} text-xs font-mono`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-hover-bg rounded"
      >
        <Caret open={expanded} className="text-fg-muted" />
        <span className={`font-semibold ${toolNameColor}`}>{toolName}</span>
        <span className="text-fg-muted truncate flex-1">{argSummary}</span>
        <StatusBadge status={status} />
      </button>

      {expanded && (
        <div className="border-t border-border-default px-3 py-2 space-y-2">
          {/* OC-21 (v0.1.8): tool input 渲染走 toolRegistry 查表分发。任意 toolName 都进
              ToolEditInputView，registry 找不到 / 返 null 就回退到 raw-JSON collapse 视图。
              新 tool 加自己的 renderer 只需 registerToolInputRenderer，不再改本文件。 */}
          <ToolEditInputView toolName={toolName} input={input} />

          {progress !== undefined && (
            <section>
              <div className="text-[11px] text-fg-muted uppercase mb-0.5">progress</div>
              <div className="text-xs text-blue-300">{progress}</div>
            </section>
          )}
          {result !== undefined && (
            <ToolResultView
              toolName={toolName}
              result={result}
              input={input}
              resultCollapse={resultCollapse}
              showFullResult={showFullResult}
              setShowFullResult={setShowFullResult}
            />
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'running' | 'done' }): JSX.Element {
  if (status === 'running') {
    return (
      <span
        className={[
          'text-[11px] uppercase px-1.5 py-0.5 rounded border',
          'dark:text-amber-400 dark:bg-amber-950/40 dark:border-amber-800/40',
          // Light: 深琥珀字 + 中浅琥珀衬底 + 中深边 — running 显眼
          'text-amber-800 bg-amber-100 border-amber-300',
        ].join(' ')}
      >
        running
      </span>
    );
  }
  return (
    <span
      className={[
        'text-[11px] uppercase px-1.5 py-0.5 rounded border',
        'dark:text-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-800/40',
        // Light: 深翠字 + 中浅翠衬底 — done 视觉确认强
        'text-emerald-800 bg-emerald-100 border-emerald-300',
      ].join(' ')}
    >
      done
    </span>
  );
}

function summarizeInput(input?: Record<string, unknown>): string {
  if (!input) return '';
  const entries = Object.entries(input);
  if (entries.length === 0) return '';
  // 优先显示常见关键字段
  const primary = ['path', 'file', 'pattern', 'command', 'query'].find((k) => k in input);
  if (primary) {
    const value = String(input[primary]).slice(0, 60);
    return `${primary}: ${value}${String(input[primary]).length > 60 ? '…' : ''}`;
  }
  // 否则取第一个字段
  const [k, v] = entries[0];
  return `${k}: ${String(v).slice(0, 60)}`;
}

// ---- System Notice (iteration_end / error) ----

// OC-11 SystemNotice action button：
//   - retry                  → focus textarea (用户按 Send 重发上次 prompt)
//   - open_provider_settings → 打开 Provider settings 模态
//
// change_model / check_network 当前没有干净的 renderer 入口，文案已经告诉用户该做什么，
// 不强行加按钮：错的按钮比没按钮更恼人。
const ACTION_BUTTONS: Partial<
  Record<
    NonNullable<Extract<ConversationMessage, { kind: 'system_notice' }>['action']>,
    { label: string; event: string }
  >
> = {
  retry: { label: 'Retry', event: 'kodax-space.focus-textarea' },
  open_provider_settings: {
    label: 'Provider settings',
    event: 'kodax-space.open-provider-settings',
  },
};

/**
 * OC-23 倒计时 hook：把绝对时间戳 retryAvailableAt 转成"剩余秒数"。0 表示已可重试。
 * 每秒 tick；retryAvailableAt 未设/已过期 → 返 0，组件不渲染倒计时态。
 */
function useRetryCountdown(retryAvailableAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (retryAvailableAt === undefined) return;
    const remaining = retryAvailableAt - Date.now();
    if (remaining <= 0) return;
    // 每秒 tick；倒计时归零时主动停 interval，避免 SystemNotice 长期 mount 时
    // 一直每秒空转 setState (review MEDIUM)
    const id = window.setInterval(() => {
      const tickNow = Date.now();
      setNow(tickNow);
      if (tickNow >= retryAvailableAt) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [retryAvailableAt]);
  if (retryAvailableAt === undefined) return 0;
  const remainingMs = retryAvailableAt - now;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

export function SystemNotice({
  variant,
  text,
  action,
  retryAvailableAt,
}: Extract<ConversationMessage, { kind: 'system_notice' }>): JSX.Element {
  const color =
    variant === 'iteration'
      ? 'text-amber-400 border-amber-900/40'
      : 'text-red-400 border-red-900/40';

  const actionDef = action ? ACTION_BUTTONS[action] : undefined;
  const secondsLeft = useRetryCountdown(retryAvailableAt);
  const countdownActive = action === 'retry' && secondsLeft > 0;

  return (
    <div
      className={`text-[11px] font-mono text-center py-1 border-y ${color} flex items-center justify-center gap-2 flex-wrap`}
    >
      <span>{text}</span>
      {actionDef && (
        <button
          type="button"
          disabled={countdownActive}
          onClick={() => window.dispatchEvent(new CustomEvent(actionDef.event))}
          className="px-1.5 py-0.5 rounded border border-current/30 hover:bg-current/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          title={countdownActive ? `Wait ${secondsLeft}s before retry` : undefined}
        >
          {countdownActive ? `Retry in ${secondsLeft}s` : actionDef.label}
        </button>
      )}
    </div>
  );
}

// ---- OC-21 (v0.1.8): tool input 视图 ----
//
// `ToolEditInputView` 是所有工具 input 渲染的统一入口（不再按 toolName 走 if-chain）。
// 实际渲染由 toolRegistry 查表分发：
//   - 内置 write / edit / multi_edit 在 toolRenderers.tsx 注册，渲染 Monaco diff
//   - 新工具想自定义渲染，调 registerToolInputRenderer，不再要改本文件
//   - 查不到 / renderer 返 null（shape 不对）→ 回退到 raw-JSON collapse 视图

interface ToolEditInputViewProps {
  toolName: string;
  input: Record<string, unknown> | undefined;
}

/**
 * OC-21 ToolRegistry 入口。
 * - 从 toolRegistry 查 toolName 对应的 renderer（pure function）
 * - 没注册 / renderer 返 null（shape 不对）→ 回退到 raw-JSON collapse 视图
 *   （承接旧 bubbles.tsx else-branch 的 Show full / Collapse UX）
 * - 内置 write / edit / multi_edit 在 toolRenderers.tsx 里 register
 *
 * 新 tool 想自定义渲染：在 toolRenderers.tsx 或自己模块里 `registerToolInputRenderer`，
 * 不再要改本文件。
 */
function ToolEditInputView({ toolName, input }: ToolEditInputViewProps): JSX.Element | null {
  // collapse 状态搬到这里 — 让 fallback 也享有 Show full / Collapse UX
  const [showFullInput, setShowFullInput] = useState(false);
  const inputPretty = useMemo<string | null>(() => {
    if (!input || Object.keys(input).length === 0) return null;
    return JSON.stringify(input, null, 2);
  }, [input]);
  const inputCollapse = useMemo<CollapseResult | null>(() => {
    if (inputPretty === null) return null;
    return collapseLargeText(inputPretty);
  }, [inputPretty]);

  const renderer = getToolInputRenderer(toolName);
  if (renderer !== null) {
    const rendered = renderer({ toolName, input });
    if (rendered !== null) return rendered;
    // renderer 返 null = shape 不对，fallback 到 raw-JSON collapse
  }

  // Fallback — raw JSON with collapse / Show full UX
  if (inputCollapse === null || inputPretty === null) return null;
  return (
    <section>
      <div className="text-[11px] text-fg-muted uppercase mb-0.5 flex justify-between items-center">
        <span>input</span>
        {inputCollapse.collapsed && (
          <button
            type="button"
            onClick={() => setShowFullInput((v) => !v)}
            className="text-[11px] text-blue-400 hover:text-blue-300 normal-case"
          >
            {showFullInput ? 'Collapse' : `Show full (${inputCollapse.totalLines} lines)`}
          </button>
        )}
      </div>
      <pre className="text-xs text-fg-secondary whitespace-pre-wrap break-all max-h-96 overflow-auto">
        {showFullInput ? inputPretty : inputCollapse.body}
      </pre>
    </section>
  );
}

// ---- OC-21 v0.1.9 result-side dispatch ----
//
// 跟 ToolEditInputView 对称：toolName 查 result registry → 自定义渲染；
// 找不到或返 null → 回退到原 raw-text collapse 视图（绿色 pre + Show full/Collapse）。

interface ToolResultViewProps {
  readonly toolName: string;
  readonly result: string;
  readonly input: Record<string, unknown> | undefined;
  readonly resultCollapse: CollapseResult | null;
  readonly showFullResult: boolean;
  readonly setShowFullResult: (updater: (v: boolean) => boolean) => void;
}

function ToolResultView({
  toolName,
  result,
  input,
  resultCollapse,
  showFullResult,
  setShowFullResult,
}: ToolResultViewProps): JSX.Element | null {
  const renderer = getToolResultRenderer(toolName);
  if (renderer !== null) {
    const rendered = renderer({ toolName, result, input });
    if (rendered !== null) return rendered;
  }
  // Fallback — raw-text collapse 视图
  if (resultCollapse === null) return null;
  return (
    <section>
      <div className="text-[11px] text-fg-muted uppercase mb-0.5 flex justify-between items-center">
        <span>result</span>
        {resultCollapse.collapsed && (
          <button
            type="button"
            onClick={() => setShowFullResult((v) => !v)}
            className="text-[11px] text-blue-400 hover:text-blue-300 normal-case"
          >
            {showFullResult ? 'Collapse' : `Show full (${resultCollapse.totalLines} lines)`}
          </button>
        )}
      </div>
      <pre
        className={[
          'text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto',
          'dark:text-emerald-300 text-emerald-700',
        ].join(' ')}
      >
        {showFullResult ? result : resultCollapse.body}
      </pre>
    </section>
  );
}
