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

export function BottomBar(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const appendUserMessage = useAppStore((s) => s.appendUserMessage);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
        className="w-full bg-transparent text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none px-1 py-1 disabled:opacity-50"
      />

      <div className="flex items-center text-[10px] text-zinc-600 gap-2">
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={!busy}
          className="hover:text-zinc-300 disabled:text-zinc-700 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <span className="ml-auto" />
        <ModelEffortSelector />
      </div>
    </div>
  );
}
