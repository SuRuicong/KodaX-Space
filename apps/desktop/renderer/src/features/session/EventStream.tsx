// EventStream — 主区。显示当前 session 的事件日志 + prompt 输入框。
//
// 事件源：useAppStore.eventsBySession[currentSessionId]——store 在 App 顶层一次性
// 订阅了 push channel，按 sessionId 路由进 bucket。本组件只读它。

import { useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';

export function EventStream(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const session = useAppStore((s) =>
    currentSessionId ? s.sessions.find((x) => x.sessionId === currentSessionId) ?? null : null,
  );
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] ?? [] : [],
  );

  const [prompt, setPrompt] = useState<string>('Read package.json and summarize');
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  // 显式收窄到 SessionMeta：currentSessionId 存在 && 在 sessions 列表里能找到
  if (currentSessionId === null || session === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
        Select or create a session in the left drawer.
      </div>
    );
  }

  async function handleSend(): Promise<void> {
    if (!currentSessionId || !window.kodaxSpace) return;
    setErr(null);
    setBusy(true);
    try {
      const result = await window.kodaxSpace.invoke('session.send', {
        sessionId: currentSessionId,
        prompt,
      });
      if (!result.ok) setErr(`${result.error.code}: ${result.error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(): Promise<void> {
    if (!currentSessionId || !window.kodaxSpace) return;
    await window.kodaxSpace.invoke('session.cancel', { sessionId: currentSessionId });
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="border-b border-zinc-800 px-4 py-2 flex items-center gap-2 text-sm">
        <span className="font-medium text-zinc-200 truncate">{session.title ?? 'Untitled session'}</span>
        <span className="text-xs text-zinc-500">
          {session.provider} · {session.reasoningMode}
        </span>
        <code className="ml-auto text-[10px] text-zinc-600 font-mono truncate max-w-[280px]" title={session.sessionId}>
          {session.sessionId}
        </code>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3 font-mono text-xs space-y-1">
        {events.length === 0 && <div className="text-zinc-600 italic">No events yet. Send a prompt below.</div>}
        {events.map((evt, idx) => (
          <EventLine key={idx} event={evt} />
        ))}
      </div>

      <div className="border-t border-zinc-800 p-3 space-y-2">
        {err && <div className="text-red-400 text-xs font-mono">{err}</div>}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prompt..."
            className="flex-1 px-3 py-2 text-sm rounded bg-zinc-950 border border-zinc-800 font-mono text-zinc-100"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={busy || prompt.trim() === ''}
            className="text-sm px-3 py-2 rounded bg-blue-700/80 hover:bg-blue-600 disabled:opacity-40 text-white"
          >
            Send
          </button>
          <button
            type="button"
            onClick={() => void handleCancel()}
            className="text-sm px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            title="Cancel current run"
          >
            ⏹
          </button>
        </div>
        <div className="text-[10px] text-zinc-600">⌘/Ctrl + Enter to send</div>
      </div>
    </div>
  );
}

function EventLine({ event }: { event: SessionEvent }): JSX.Element {
  const colorByKind: Record<SessionEvent['kind'], string> = {
    text_delta: 'text-zinc-200',
    thinking_delta: 'text-purple-400',
    tool_start: 'text-blue-400',
    tool_progress: 'text-blue-300',
    tool_result: 'text-emerald-400',
    iteration_end: 'text-amber-400',
    session_complete: 'text-emerald-500 font-semibold',
    session_error: 'text-red-400',
  };
  return (
    <div className={`whitespace-pre-wrap ${colorByKind[event.kind]}`}>
      <span className="text-zinc-600">[{event.kind}]</span> {formatEventBody(event)}
    </div>
  );
}

function formatEventBody(event: SessionEvent): string {
  switch (event.kind) {
    case 'text_delta':
    case 'thinking_delta':
      return event.text;
    case 'tool_start':
      return `${event.toolName}(${event.input ? JSON.stringify(event.input) : ''})`;
    case 'tool_progress':
      return event.message;
    case 'tool_result':
      return `${event.toolName} → ${event.content.slice(0, 80)}${event.content.length > 80 ? '…' : ''}`;
    case 'iteration_end':
      return `iter ${event.iter}/${event.maxIter} · ${event.tokenCount} tokens`;
    case 'session_complete':
      return '✓ complete';
    case 'session_error':
      return event.error;
  }
}
