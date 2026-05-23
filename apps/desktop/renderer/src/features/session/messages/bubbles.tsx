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

// ---- User Bubble ----

export function UserBubble({ content }: { content: string }): JSX.Element {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-lg bg-blue-900/40 border border-blue-800/40 px-3 py-2 text-sm whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

// ---- Assistant Bubble (markdown + 可选 thinking) ----

export function AssistantBubble({
  text,
  thinking,
}: {
  text: string;
  thinking?: string;
}): JSX.Element {
  const [showThinking, setShowThinking] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      {thinking !== undefined && (
        <div>
          <button
            type="button"
            onClick={() => setShowThinking((v) => !v)}
            className="text-[11px] text-purple-400 hover:text-purple-300 font-mono"
          >
            {showThinking ? '▼' : '▶'} thinking ({thinking.length} chars)
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

// ---- System Notice (iteration_end / complete / error) ----

export function SystemNotice({
  variant,
  text,
}: Extract<ConversationMessage, { kind: 'system_notice' }>): JSX.Element {
  const color =
    variant === 'iteration'
      ? 'text-amber-400 border-amber-900/40'
      : variant === 'complete'
        ? 'text-emerald-400 border-emerald-900/40'
        : 'text-red-400 border-red-900/40';
  return (
    <div className={`text-[10px] font-mono text-center py-1 border-y ${color}`}>{text}</div>
  );
}
