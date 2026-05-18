// BottomBar — F011-revised
//
// 三层结构（自下而上）：
//   1. Footer-row：Mode/Gateway 左下，Model+Effort 右下（弹出选择）
//   2. InputBox：textarea + Send/Cancel
//   3. ChipBar：Local · Project · branch · worktree-flag
//
// 取代旧 EventStream 底部 InputBox 区。

import { useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { ChipBar } from './ChipBar.js';
import { ModelEffortSelector } from './ModelEffortSelector.js';
import { ModeSelector } from './ModeSelector.js';
import { ContextWindowIndicator } from './ContextWindowIndicator.js';
import { AttachMenu } from './AttachMenu.js';

export function BottomBar(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const appendUserMessage = useAppStore((s) => s.appendUserMessage);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);

  async function handleSend(): Promise<void> {
    if (!currentSessionId || !window.kodaxSpace) return;
    const trimmed = prompt.trim();
    if (trimmed === '') return;
    setErr(null);
    setBusy(true);
    appendUserMessage(currentSessionId, trimmed);
    setPrompt('');
    try {
      const result = await window.kodaxSpace.invoke('session.send', {
        sessionId: currentSessionId,
        prompt: trimmed,
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

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="border-t border-zinc-900 px-3 py-2 flex-shrink-0 space-y-1.5">
      {err && <div className="text-red-400 text-[11px] font-mono px-1">{err}</div>}

      <ChipBar />

      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy || !currentSessionId}
          rows={2}
          placeholder={
            currentSessionId
              ? 'Describe a task or ask a question — Type / for commands'
              : 'Select or create a session first'
          }
          className="w-full bg-transparent text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none px-1 py-1 pr-44 disabled:opacity-50"
        />
        {/* Context window indicator 浮在输入框右下角 — Claude Desktop 截图 3 同款位置 */}
        <div className="absolute right-1 bottom-1 pointer-events-auto">
          <ContextWindowIndicator />
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px]">
        <div className="relative">
          <button
            type="button"
            onClick={() => setAttachOpen((v) => !v)}
            disabled={!currentSessionId}
            className="w-5 h-5 rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:text-zinc-700 disabled:cursor-not-allowed text-sm flex items-center justify-center"
            title="Attach / Commands"
            aria-label="Open attach menu"
          >
            ＋
          </button>
          <AttachMenu
            open={attachOpen}
            onClose={() => setAttachOpen(false)}
            onInsertText={(text) => setPrompt((p) => (p ? `${p} ${text}` : text))}
          />
        </div>
        <ModeSelector />
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={!busy}
          className="text-zinc-600 hover:text-zinc-300 disabled:text-zinc-700 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <span className="ml-auto" />
        <ModelEffortSelector />
      </div>
    </div>
  );
}
