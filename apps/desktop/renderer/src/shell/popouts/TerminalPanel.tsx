// TerminalPanel — bash tool history viewer (v0.1.x)
//
// 不是真的 PTY 终端 (那需要 node-pty + xterm.js, 留 v0.1.x+),而是 KodaX 在当前 session 里
// 用 `bash` 工具跑过的命令的历史记录:
//   - 命令文本
//   - cwd (input.cwd 或 input.workdir,有就显示)
//   - stdout/stderr 预览 (前 2KB)
//   - 退出状态推断: tool_result kind / 内容里 "exit code N"
//   - 点击"copy command" 复制命令到剪贴板
//
// 数据源: events buffer 里所有 tool_start (toolName='bash') 配对的 tool_result。
// 倒序显示 (最新在前)。session 切换时自动清空 (events 由 store 按 sessionId 路由)。

import { useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';

const EMPTY_EVENTS: readonly SessionEvent[] = [];

interface BashCall {
  readonly toolId: string;
  readonly command: string;
  readonly cwd?: string;
  readonly result?: string;
  readonly status: 'running' | 'done';
}

/** 倒扫 events 提取 bash 工具调用对. */
function extractBashCalls(events: readonly SessionEvent[]): BashCall[] {
  const calls = new Map<string, BashCall>();
  // 先扫 tool_start
  for (const ev of events) {
    if (ev.kind !== 'tool_start') continue;
    if ((ev as { toolName?: string }).toolName !== 'bash') continue;
    const input = (ev as { input?: Record<string, unknown> }).input ?? {};
    const rawCmd = input.command ?? input.cmd ?? input.script ?? input.shell;
    if (typeof rawCmd !== 'string') continue;
    const rawCwd = input.cwd ?? input.workdir;
    calls.set(ev.toolId, {
      toolId: ev.toolId,
      command: rawCmd,
      cwd: typeof rawCwd === 'string' && rawCwd.length > 0 ? rawCwd : undefined,
      status: 'running',
    });
  }
  // 再扫 tool_result 配对
  for (const ev of events) {
    if (ev.kind !== 'tool_result') continue;
    if ((ev as { toolName?: string }).toolName !== 'bash') continue;
    const existing = calls.get(ev.toolId);
    if (!existing) continue;
    calls.set(ev.toolId, {
      ...existing,
      result: ev.content,
      status: 'done',
    });
  }
  // 转 array,倒序 (最新在前)
  return Array.from(calls.values()).reverse();
}

const RESULT_PREVIEW_BYTES = 2 * 1024;

export function TerminalPanel(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  const calls = extractBashCalls(events);

  function toggleExpand(toolId: string): void {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }

  async function copyCommand(cmd: string, toolId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(toolId);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard 不可用 — 静默 */
    }
  }

  if (!currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-xs">
        No active session.
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-xs p-4 gap-2">
        <span aria-hidden className="text-2xl">{'>_'}</span>
        <div className="text-zinc-500">No bash commands yet</div>
        <div className="text-center max-w-[280px]">
          KodaX's bash tool calls in this session will appear here with stdout/stderr previews
          and a copy-command button.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col text-xs">
      <header className="px-3 py-2 border-b border-zinc-800/60 flex items-center justify-between flex-shrink-0">
        <div className="text-zinc-300 font-medium">
          Bash history{' '}
          <span className="text-zinc-500 font-normal">({calls.length} commands)</span>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-2 py-2 space-y-1.5">
        {calls.map((c) => {
          const isExpanded = expanded.has(c.toolId);
          const resultPreview = c.result
            ? c.result.length > RESULT_PREVIEW_BYTES && !isExpanded
              ? c.result.slice(0, RESULT_PREVIEW_BYTES) + '\n…(truncated, click to expand)'
              : c.result
            : null;
          return (
            <div key={c.toolId} className="border border-zinc-800/60 rounded">
              <div className="px-2 py-1 flex items-start gap-2">
                <span
                  className={`mt-0.5 ${c.status === 'running' ? 'text-amber-400' : 'text-emerald-400'}`}
                  aria-hidden
                  title={c.status}
                >
                  {c.status === 'running' ? '⟳' : '✓'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-zinc-200 break-words leading-relaxed">
                    {c.command}
                  </div>
                  {c.cwd && (
                    <div className="text-[10px] text-zinc-500 font-mono mt-0.5" title={c.cwd}>
                      cwd: {c.cwd}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void copyCommand(c.command, c.toolId)}
                  className="text-[10px] text-zinc-400 hover:text-zinc-100 px-1.5 py-0.5 rounded hover:bg-zinc-800 flex items-center gap-1"
                  title="Copy command"
                >
                  {copied === c.toolId ? (
                    '✓ copied'
                  ) : (
                    <>
                      {/* Lucide-style copy icon —— 之前 Unicode ⎘ 太弱看不见 */}
                      <svg
                        aria-hidden
                        width="11"
                        height="11"
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
                      copy
                    </>
                  )}
                </button>
              </div>
              {resultPreview !== null && (
                <button
                  type="button"
                  onClick={() => toggleExpand(c.toolId)}
                  className="w-full text-left border-t border-zinc-900 px-2 py-1 hover:bg-zinc-900/50 cursor-pointer"
                  title={isExpanded ? 'Click to collapse' : 'Click to expand'}
                >
                  <pre className="text-[10.5px] text-zinc-400 font-mono whitespace-pre-wrap break-words leading-snug max-h-96 overflow-auto">
                    {resultPreview}
                  </pre>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
