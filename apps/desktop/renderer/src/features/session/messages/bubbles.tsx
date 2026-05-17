// Bubble + ToolCallCard + SystemNotice 组件集合。
// 单文件聚合：每个组件 < 80 行，共享 ConversationMessage 类型，拆分反而提高复杂度。

import { useState } from 'react';
import type { ConversationMessage } from '../composeMessages.js';
import { Markdown } from './Markdown.js';

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
  const colorClass = TOOL_KIND_COLOR[toolName] ?? 'border-zinc-700 bg-zinc-900/50';
  const argSummary = summarizeInput(input);

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
          {input && Object.keys(input).length > 0 && (
            <section>
              <div className="text-[10px] text-zinc-500 uppercase mb-0.5">input</div>
              <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap break-all">
                {JSON.stringify(input, null, 2)}
              </pre>
            </section>
          )}
          {progress !== undefined && (
            <section>
              <div className="text-[10px] text-zinc-500 uppercase mb-0.5">progress</div>
              <div className="text-[11px] text-blue-300">{progress}</div>
            </section>
          )}
          {result !== undefined && (
            <section>
              <div className="text-[10px] text-zinc-500 uppercase mb-0.5">result</div>
              <pre className="text-[11px] text-emerald-300 whitespace-pre-wrap break-all max-h-64 overflow-auto">
                {result.length > 4096 ? `${result.slice(0, 4096)}\n…(truncated, ${result.length - 4096} more chars)` : result}
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
