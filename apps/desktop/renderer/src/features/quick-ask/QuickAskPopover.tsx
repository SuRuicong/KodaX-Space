import { useEffect, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import type { SessionEvent, SessionMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { resolveSessionCreateInputs } from '../../shell/createSession.js';
import { Markdown } from '../session/messages/Markdown.js';

type AskState =
  | { kind: 'idle' }
  | { kind: 'creating-session' }
  | {
      kind: 'streaming';
      sessionId: string;
      prompt: string;
      reply: string;
      session: SessionMeta;
      events: readonly SessionEvent[];
    }
  | {
      kind: 'done';
      sessionId: string;
      prompt: string;
      reply: string;
      session: SessionMeta;
      events: readonly SessionEvent[];
    }
  | { kind: 'error'; message: string; sessionId?: string };

interface QuickAskPopoverProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function QuickAskPopover({ open, onClose }: QuickAskPopoverProps): JSX.Element | null {
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<AskState>({ kind: 'idle' });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const runSeqRef = useRef(0);

  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const runtimeDefaults = useAppStore((s) => s.runtimeDefaults);
  const pendingProviderId = useAppStore((s) => s.pendingProviderId);
  const pendingModel = useAppStore((s) => s.pendingModel);
  const pendingReasoningMode = useAppStore((s) => s.pendingReasoningMode);
  const pendingAutoModeEngine = useAppStore((s) => s.pendingAutoModeEngine);
  const pendingAgentMode = useAppStore((s) => s.pendingAgentMode);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);

  useEffect(() => {
    if (!open) return;
    setPrompt('');
    setState({ kind: 'idle' });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [open]);

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
    // closeAndCleanup intentionally reads the latest local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state]);

  async function closeAndCleanup(): Promise<void> {
    runSeqRef.current += 1;
    if (
      (state.kind === 'streaming' || state.kind === 'done' || state.kind === 'error') &&
      state.sessionId &&
      window.kodaxSpace
    ) {
      try {
        await window.kodaxSpace.invoke('session.cancel', { sessionId: state.sessionId });
        await window.kodaxSpace.invoke('session.delete', { sessionId: state.sessionId });
      } catch {
        // Best-effort cleanup; closing the popover should not get stuck.
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

    setPrompt('');
    const runSeq = runSeqRef.current + 1;
    runSeqRef.current = runSeq;
    const isActiveRun = (): boolean => runSeqRef.current === runSeq;
    const setActiveState = (next: AskState): void => {
      if (isActiveRun()) setState(next);
    };

    setActiveState({ kind: 'creating-session' });

    const resolved = resolveSessionCreateInputs({
      projectRoot: currentProjectPath,
      providers,
      defaultProviderId,
      kodaxDefaults,
      spaceRuntimeDefaults: runtimeDefaults,
      pendingProviderId,
      pendingReasoningMode,
      pendingPermissionMode: 'plan',
      pendingAutoModeEngine,
      pendingAgentMode,
      pendingModel,
    });

    const createResult = await window.kodaxSpace.invoke('session.create', {
      projectRoot: currentProjectPath,
      provider: resolved.provider,
      ...(resolved.model ? { model: resolved.model } : {}),
      ...resolved.runtimeOverrides,
      surface: 'code',
    });
    if (!createResult.ok) {
      setActiveState({ kind: 'error', message: createResult.error?.message ?? 'create failed' });
      return;
    }

    const sessionId = createResult.data.sessionId;
    if (!isActiveRun()) {
      try {
        await window.kodaxSpace.invoke('session.delete', { sessionId });
      } catch {
        // Best-effort cleanup for a session created after the popover was closed.
      }
      return;
    }

    const session: SessionMeta = {
      sessionId,
      projectRoot: currentProjectPath,
      provider: resolved.provider,
      ...(resolved.model ? { model: resolved.model } : {}),
      reasoningMode: createResult.data.reasoningMode,
      permissionMode: createResult.data.permissionMode,
      autoModeEngine: createResult.data.autoModeEngine,
      agentMode: createResult.data.agentMode,
      surface: 'code',
      title: 'Quick Ask',
      createdAt: createResult.data.createdAt,
      lastActivityAt: createResult.data.createdAt,
    };

    const capturedEvents: SessionEvent[] = [];
    const unsubscribe = window.kodaxSpace.on('session.event', (event) => {
      if (event.sessionId === sessionId) capturedEvents.push(event);
    });

    let reply = '';
    setActiveState({ kind: 'streaming', sessionId, prompt: trimmed, reply, session, events: [] });

    const sendResult = await window.kodaxSpace.invoke('session.send', {
      sessionId,
      prompt: trimmed,
      queueMode: 'interrupt',
      expectedProjectRoot: currentProjectPath,
      expectedSurface: 'code',
    });
    if (!sendResult.ok) {
      unsubscribe();
      setActiveState({
        kind: 'error',
        sessionId,
        message: sendResult.error?.message ?? 'send failed',
      });
      return;
    }

    const startTime = Date.now();
    const pollIntervalMs = 80;
    const timeoutMs = 60_000;

    try {
      while (Date.now() - startTime < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        reply = '';
        let terminal: 'complete' | 'error' | null = null;
        let errorMessage = '';

        for (const event of capturedEvents) {
          if (event.kind === 'text_delta') reply += event.text;
          else if (event.kind === 'session_complete') terminal = 'complete';
          else if (event.kind === 'session_error') {
            terminal = 'error';
            errorMessage = event.error;
          }
        }

        const events = capturedEvents.slice();
        setActiveState({ kind: 'streaming', sessionId, prompt: trimmed, reply, session, events });

        if (terminal === 'complete') {
          setActiveState({ kind: 'done', sessionId, prompt: trimmed, reply, session, events });
          return;
        }
        if (terminal === 'error') {
          setActiveState({ kind: 'error', sessionId, message: errorMessage });
          return;
        }
      }

      setActiveState({
        kind: 'done',
        sessionId,
        prompt: trimmed,
        reply: reply || '(timed out)',
        session,
        events: capturedEvents.slice(),
      });
    } finally {
      unsubscribe();
    }
  }

  function continueInCoder(): void {
    if (state.kind !== 'done') return;
    const title = state.prompt.replace(/\s+/g, ' ').slice(0, 80) || 'Quick Ask';
    upsertSession({ ...state.session, title, lastActivityAt: Date.now() });
    setCurrentSession(state.sessionId);
    onClose();
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
          <span className="text-[11px] text-fg-muted font-mono">plan mode / temporary</span>
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
                ? 'Ask anything about this project (no file edits)'
                : 'Open a project first to use Quick Ask'
            }
            className="w-full resize-none bg-transparent text-fg-primary placeholder-fg-muted text-sm focus:outline-none disabled:opacity-50"
          />

          {(state.kind === 'streaming' || state.kind === 'done') && state.reply.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border-default">
              <Markdown content={state.reply} />
              {state.kind === 'streaming' && (
                <span className="text-[11px] text-fg-muted font-mono">streaming...</span>
              )}
            </div>
          )}

          {state.kind === 'error' && (
            <div className="mt-3 pt-3 border-t dark:border-danger/60 border-danger text-xs text-danger">
              {state.message}
            </div>
          )}

          {state.kind === 'creating-session' && (
            <div className="mt-3 pt-3 border-t border-border-default text-[11px] text-fg-muted font-mono">
              creating session...
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border-default flex items-center justify-between gap-2 text-[11px] text-fg-muted font-mono flex-shrink-0">
          <span>Enter to send / Shift+Enter newline / Esc close</span>
          {state.kind === 'done' && (
            <button
              type="button"
              onClick={continueInCoder}
              className="ml-auto px-2 py-0.5 rounded bg-info/15 text-info border border-info/50 hover:bg-info/25"
            >
              Continue in Coder
            </button>
          )}
          <button
            type="button"
            disabled={isAsking || !prompt.trim() || !currentProjectPath}
            onClick={() => void handleSend()}
            className="px-2 py-0.5 rounded bg-ok/15 text-ok border border-ok/50 hover:bg-ok/25 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAsking ? 'Asking...' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}
