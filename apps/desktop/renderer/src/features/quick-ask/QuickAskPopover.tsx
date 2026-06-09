// Quick Ask popover — F018 (v0.1.2)
//
// Cmd/Ctrl+K 召出居中浮层，问个小问题不离开当前 session。
// 流程：
//   1. 用户敲 Cmd+K → modal 打开，自动 focus textarea
//   2. 输入 prompt + Enter → 创建一个 ephemeral session (plan mode 不写文件)，
//      调 session.send 流式拿 reply
//   3. text_delta 累计进 reply state，session_complete / session_error 停
//   4. Esc 关闭 → cancel + delete 临时 session 不留痕
//
// 设计取舍 (v1)：
//   - 用真 session.send 而不是 SDK sideQuery API —— 现有 IPC 完全够用，
//     新接 sideQuery 需要 provider/model/messages 转换 + 独立 timeout，> 1 天工作
//   - permissionMode='plan' —— Quick Ask 不应该写文件 / 跑 bash；plan mode 让
//     SDK 自己 deny mutating tools。但仍能 read / grep / glob 检索代码回答问题
//   - 临时 session 在 Esc 时 cancel + delete；用户主动关掉浏览器/进程时仍会
//     残留一条 session 在 Recents（acceptable for v1 — 后续 v2 改用真 sideQuery）

import { useEffect, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';
import { resolveSessionCreateInputs } from '../../shell/createSession.js';
import { Markdown } from '../session/messages/Markdown.js';

type AskState =
  | { kind: 'idle' }
  | { kind: 'creating-session' }
  | { kind: 'streaming'; sessionId: string; reply: string }
  | { kind: 'done'; sessionId: string; reply: string }
  | { kind: 'error'; message: string };

interface QuickAskPopoverProps {
  open: boolean;
  onClose: () => void;
}

export function QuickAskPopover({ open, onClose }: QuickAskPopoverProps): JSX.Element | null {
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<AskState>({ kind: 'idle' });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Store fields needed for resolveSessionCreateInputs
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const pendingProviderId = useAppStore((s) => s.pendingProviderId);
  const pendingReasoningMode = useAppStore((s) => s.pendingReasoningMode);
  // 不读 pendingPermissionMode —— Quick Ask 强制 plan 不让用户的 accept-edits / auto 默认
  // 让 SDK 写文件 / 跑 bash
  const pendingAgentMode = useAppStore((s) => s.pendingAgentMode);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setPrompt('');
      setState({ kind: 'idle' });
      // 下一帧 focus textarea
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  // Esc 全局关闭 + 清理临时 session
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void closeAndCleanup();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state.kind]);

  async function closeAndCleanup(): Promise<void> {
    // 关掉临时 session（cancel in-flight + delete from store / disk）
    if ((state.kind === 'streaming' || state.kind === 'done') && window.kodaxSpace) {
      const sid = state.sessionId;
      try {
        await window.kodaxSpace.invoke('session.cancel', { sessionId: sid });
        await window.kodaxSpace.invoke('session.delete', { sessionId: sid });
      } catch {
        // best-effort 清理；失败也 close popup
      }
    }
    onClose();
  }

  async function handleSend(): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed || !window.kodaxSpace) return;
    if (!currentProjectPath) {
      setState({ kind: 'error', message: 'Open a project first to use Quick Ask.' });
      return;
    }
    setState({ kind: 'creating-session' });
    setPrompt('');

    // 创建临时 session —— plan mode 让 SDK deny mutating tools
    const resolved = resolveSessionCreateInputs({
      projectRoot: currentProjectPath,
      providers,
      defaultProviderId,
      kodaxDefaults,
      pendingProviderId,
      pendingReasoningMode,
      pendingPermissionMode: 'plan', // 强制 plan，不让 Quick Ask 改文件 / 跑 shell
      pendingAgentMode,
    });
    const createR = await window.kodaxSpace.invoke('session.create', {
      projectRoot: currentProjectPath,
      provider: resolved.provider,
      reasoningMode: resolved.reasoningMode,
      permissionMode: resolved.permissionMode,
      agentMode: resolved.agentMode,
    });
    if (!createR.ok) {
      setState({ kind: 'error', message: createR.error?.message ?? 'create failed' });
      return;
    }
    const sid = createR.data.sessionId;

    // 订阅 events for THIS sid 一直到 complete / error
    // —— 走 store 而不是直接 IPC subscribe；store 已经全局监听 session.event push channel
    let reply = '';
    setState({ kind: 'streaming', sessionId: sid, reply });

    // Poll store 直到看到 terminal event；轮询比 store 订阅 cleanup 简单
    const startTime = Date.now();
    const POLL_INTERVAL_MS = 80;
    const TIMEOUT_MS = 60_000;

    const sendR = await window.kodaxSpace.invoke('session.send', {
      sessionId: sid,
      prompt: trimmed,
    });
    if (!sendR.ok) {
      setState({ kind: 'error', message: sendR.error?.message ?? 'send failed' });
      return;
    }

    while (Date.now() - startTime < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const events = useAppStore.getState().eventsBySession[sid] ?? [];
      reply = '';
      let terminated: 'complete' | 'error' | null = null;
      let errMsg = '';
      for (const ev of events) {
        if (ev.kind === 'text_delta') {
          reply += ev.text;
        } else if (ev.kind === 'session_complete') {
          terminated = 'complete';
        } else if (ev.kind === 'session_error') {
          terminated = 'error';
          errMsg = ev.error;
        }
      }
      // Live 更新 streaming reply
      setState({ kind: 'streaming', sessionId: sid, reply });
      if (terminated === 'complete') {
        setState({ kind: 'done', sessionId: sid, reply });
        return;
      }
      if (terminated === 'error') {
        setState({ kind: 'error', message: errMsg });
        return;
      }
    }
    // Timeout — leave state at last streaming snapshot but tag done so user sees what they got
    setState({ kind: 'done', sessionId: sid, reply: reply || '(timed out)' });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (!open) return null;

  const isAsking = state.kind === 'creating-session' || state.kind === 'streaming';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-ask-title"
      onClick={(e) => {
        // 点击 backdrop 关闭（textarea 上的点击不冒泡到这里因为 stopPropagation 在子层）
        if (e.target === e.currentTarget) void closeAndCleanup();
      }}
    >
      <div
        className="w-[640px] max-w-[92vw] max-h-[80vh] flex flex-col dark:bg-surface-2 bg-surface border border-border-default rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border-default flex items-center gap-2 flex-shrink-0">
          <Zap className="w-4 h-4 text-accent-ink flex-shrink-0" strokeWidth={2} aria-hidden />
          <h2 id="quick-ask-title" className="text-sm font-semibold text-fg-primary">
            Quick Ask
          </h2>
          <span className="text-[11px] text-fg-muted font-mono">plan mode · ephemeral</span>
          <button
            type="button"
            onClick={() => void closeAndCleanup()}
            className="ml-auto text-[11px] text-fg-muted hover:text-fg-secondary"
            aria-label="Close Quick Ask"
            title="Esc to close"
          >
            Esc
          </button>
        </div>

        <div className="px-4 py-3 flex-1 overflow-y-auto">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={isAsking}
            rows={2}
            placeholder={
              currentProjectPath
                ? 'Ask anything about this project (no file edits)…'
                : 'Open a project first to use Quick Ask'
            }
            className="w-full resize-none bg-transparent text-fg-primary placeholder-fg-muted text-sm focus:outline-none disabled:opacity-50"
          />
          {(state.kind === 'streaming' || state.kind === 'done') && state.reply.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border-default">
              <Markdown content={state.reply} />
              {state.kind === 'streaming' && (
                <span className="text-[11px] text-fg-muted font-mono">●●● streaming…</span>
              )}
            </div>
          )}
          {state.kind === 'error' && (
            <div className="mt-3 pt-3 border-t dark:border-red-900/60 border-red-200 text-xs dark:text-red-400 text-red-700">
              {state.message}
            </div>
          )}
          {state.kind === 'creating-session' && (
            <div className="mt-3 pt-3 border-t border-border-default text-[11px] text-fg-muted font-mono">
              creating session…
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border-default flex items-center justify-between text-[11px] text-fg-muted font-mono flex-shrink-0">
          <span>Enter to send · Shift+Enter newline · Esc close</span>
          <button
            type="button"
            disabled={isAsking || !prompt.trim() || !currentProjectPath}
            onClick={() => void handleSend()}
            className="px-2 py-0.5 rounded dark:bg-emerald-700 dark:text-emerald-100 dark:hover:bg-emerald-600 bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAsking ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}
