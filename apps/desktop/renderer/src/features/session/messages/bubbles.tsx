// Bubble + ToolCallCard + SystemNotice 组件集合。
// 单文件聚合：每个组件 < 80 行，共享 ConversationMessage 类型，拆分反而提高复杂度。

import { useMemo, useState } from 'react';
import type { ConversationMessage } from '../composeMessages.js';
import { Markdown } from './Markdown.js';

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
    <div className="mt-1 flex items-center gap-2 text-[10px]">
      <button
        type="button"
        onClick={() => void copyToClipboard()}
        className="group/copy flex items-center gap-1 text-zinc-500 hover:text-zinc-200 transition-colors"
        title="Copy message"
        aria-label="Copy message"
      >
        {copied ? (
          <span className="text-emerald-400">✓ copied</span>
        ) : (
          <>
            <span aria-hidden>⎘</span>
            <span className="opacity-0 max-w-0 overflow-hidden group-hover/copy:opacity-100 group-hover/copy:max-w-[40px] transition-all duration-150">
              copy
            </span>
          </>
        )}
      </button>
      {timeStr && (
        <span
          className="text-zinc-500"
          title={new Date(sentAt!).toLocaleString()}
        >
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

export function UserBubble({
  content,
  sentAt,
}: {
  content: string;
  sentAt?: number;
}): JSX.Element {
  return (
    <div className="group flex flex-col items-end">
      <div
        className={[
          'max-w-[80%] rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap',
          // Dark: 深蓝 40% tint + 同色边 — 跟暗黑卡片清晰区隔
          'dark:bg-blue-900/40 dark:border-blue-800/40',
          // Light: 浅蓝实色 + 中色边 — 白底卡片上一眼能看出"这是用户在说话"
          'bg-blue-100 border-blue-300 text-blue-950',
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
  return (
    <div className="group flex flex-col gap-1.5">
      {thinking !== undefined && (
        <div>
          <button
            type="button"
            onClick={() => setShowThinking((v) => !v)}
            className="text-[11px] text-purple-400 hover:text-purple-300 font-mono"
          >
            {showThinking ? '▼' : '▶'} Thinking (~{approxTokens(thinking)} tokens)
          </button>
          {showThinking && (
            <div className="mt-1 ml-3 pl-2 border-l-2 border-purple-900/60 text-purple-300/80 text-xs whitespace-pre-wrap">
              {thinking}
            </div>
          )}
        </div>
      )}
      <div className="text-sm text-zinc-100">
        {text.length > 0 ? <Markdown content={text} /> : <span className="text-zinc-600 italic">…</span>}
      </div>
      {text.length > 0 && <MessageFooter text={text} sentAt={sentAt} />}
    </div>
  );
}

// ---- Tool Call Card ----

const TOOL_KIND_COLOR: Record<string, string> = {
  read: 'border-blue-800/40 bg-blue-950/30',
  write: 'border-amber-800/40 bg-amber-950/30',
  edit: 'border-amber-800/40 bg-amber-950/30',
  bash: 'border-red-800/40 bg-red-950/30',
  grep: 'border-emerald-800/40 bg-emerald-950/30',
  glob: 'border-emerald-800/40 bg-emerald-950/30',
};

export function ToolCallCard({
  toolName,
  input,
  result,
  progress,
  status,
}: Extract<ConversationMessage, { kind: 'tool_call' }>): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [showFullResult, setShowFullResult] = useState(false);
  const [showFullInput, setShowFullInput] = useState(false);
  const colorClass = TOOL_KIND_COLOR[toolName] ?? 'border-zinc-700 bg-zinc-900/50';
  const argSummary = summarizeInput(input);

  // P4c: result 走行级折叠（diff middle-collapse / 极端守门）
  const resultCollapse = useMemo<CollapseResult | null>(() => {
    if (result === undefined) return null;
    return collapseLargeText(result);
  }, [result]);

  // P4c: input JSON.stringify 也可能巨长（如 write tool 的 content 字段）— 同样做行折叠
  const inputPretty = useMemo<string | null>(() => {
    if (!input || Object.keys(input).length === 0) return null;
    return JSON.stringify(input, null, 2);
  }, [input]);
  const inputCollapse = useMemo<CollapseResult | null>(() => {
    if (inputPretty === null) return null;
    return collapseLargeText(inputPretty);
  }, [inputPretty]);

  return (
    <div className={`rounded border ${colorClass} text-xs font-mono`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-zinc-900/40 rounded"
      >
        <span className="text-zinc-500">{expanded ? '▼' : '▶'}</span>
        <span className="font-semibold text-zinc-200">{toolName}</span>
        <span className="text-zinc-400 truncate flex-1">{argSummary}</span>
        <StatusBadge status={status} />
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 px-3 py-2 space-y-2">
          {inputCollapse && inputPretty !== null && (
            <section>
              <div className="text-[10px] text-zinc-500 uppercase mb-0.5 flex justify-between items-center">
                <span>input</span>
                {inputCollapse.collapsed && (
                  <button
                    type="button"
                    onClick={() => setShowFullInput((v) => !v)}
                    className="text-[10px] text-blue-400 hover:text-blue-300 normal-case"
                  >
                    {showFullInput ? 'Collapse' : `Show full (${inputCollapse.totalLines} lines)`}
                  </button>
                )}
              </div>
              <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap break-all max-h-96 overflow-auto">
                {showFullInput ? inputPretty : inputCollapse.body}
              </pre>
            </section>
          )}
          {progress !== undefined && (
            <section>
              <div className="text-[10px] text-zinc-500 uppercase mb-0.5">progress</div>
              <div className="text-[11px] text-blue-300">{progress}</div>
            </section>
          )}
          {resultCollapse && result !== undefined && (
            <section>
              <div className="text-[10px] text-zinc-500 uppercase mb-0.5 flex justify-between items-center">
                <span>result</span>
                {resultCollapse.collapsed && (
                  <button
                    type="button"
                    onClick={() => setShowFullResult((v) => !v)}
                    className="text-[10px] text-blue-400 hover:text-blue-300 normal-case"
                  >
                    {showFullResult ? 'Collapse' : `Show full (${resultCollapse.totalLines} lines)`}
                  </button>
                )}
              </div>
              <pre className="text-[11px] text-emerald-300 whitespace-pre-wrap break-all max-h-64 overflow-auto">
                {showFullResult ? result : resultCollapse.body}
              </pre>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'running' | 'done' }): JSX.Element {
  if (status === 'running') {
    return (
      <span className="text-[10px] uppercase text-amber-400 bg-amber-950/40 border border-amber-800/40 px-1.5 py-0.5 rounded">
        running
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-1.5 py-0.5 rounded">
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

export function SystemNotice({
  variant,
  text,
}: Extract<ConversationMessage, { kind: 'system_notice' }>): JSX.Element {
  const color =
    variant === 'iteration'
      ? 'text-amber-400 border-amber-900/40'
      : 'text-red-400 border-red-900/40';
  return (
    <div className={`text-[10px] font-mono text-center py-1 border-y ${color}`}>{text}</div>
  );
}
