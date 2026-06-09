// EventStream —— 主区 session 视图。F006 起改成"对话流 + 输入框"形态。
//
// 职责：
//   - 取当前 session meta（显示在标头）
//   - 渲染 ConversationStream（消息编排 + 滚动）
//   - 渲染 InputBox（textarea + 发送 / 取消按钮）
//   - 发送时：把 prompt 推进 store 的 userMessagesBySession，再走 IPC session.send

import { useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { ConversationStream } from './messages/ConversationStream.js';
import { InputBox } from './messages/InputBox.js';
import { TopBar } from '../code/TopBar.js';

export function EventStream(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const session = useAppStore((s) =>
    currentSessionId ? (s.sessions.find((x) => x.sessionId === currentSessionId) ?? null) : null,
  );
  const appendUserMessage = useAppStore((s) => s.appendUserMessage);

  const [prompt, setPrompt] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  if (currentSessionId === null || session === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-faint text-sm">
        Select or create a session in the left drawer.
      </div>
    );
  }

  async function handleSend(): Promise<void> {
    if (!currentSessionId || !window.kodaxSpace) return;
    const trimmed = prompt.trim();
    if (trimmed === '') return;
    setErr(null);
    setBusy(true);
    // 本地先记录用户消息（IPC 失败也保留这条记录，配合 error 提示让用户看到"我发了什么"）
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

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="border-b border-border-default px-4 py-2 flex items-center gap-2 text-sm flex-shrink-0">
        <span className="font-medium text-fg-primary truncate">
          {session.title ?? 'Untitled session'}
        </span>
        <code
          className="ml-auto text-[11px] text-fg-faint font-mono truncate max-w-[280px]"
          title={session.sessionId}
        >
          {session.sessionId}
        </code>
      </div>

      {/* F008 顶栏：provider / Work / harness / reasoning。TopBar 自己从 store 读 session
          以避免 stale prop（review M-code-2） */}
      <TopBar sessionId={currentSessionId} />

      <ConversationStream sessionId={currentSessionId} />

      <div className="border-t border-border-default p-3 space-y-2 flex-shrink-0">
        {err && <div className="text-danger text-xs font-mono">{err}</div>}
        <InputBox
          value={prompt}
          onChange={setPrompt}
          onSubmit={() => void handleSend()}
          onCancel={() => void handleCancel()}
          disabled={busy}
        />
      </div>
    </div>
  );
}
