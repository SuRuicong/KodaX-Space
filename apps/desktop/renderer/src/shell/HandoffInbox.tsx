import { useCallback, useEffect, useRef, useState } from 'react';
import { Inbox, X } from 'lucide-react';
import type { HandoffFileT } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

export function HandoffInbox(): JSX.Element | null {
  const [handoffs, setHandoffs] = useState<readonly HandoffFileT[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);

  const refresh = useCallback(async (): Promise<void> => {
    if (!window.kodaxSpace) return;
    const result = await window.kodaxSpace.invoke('handoff.list', undefined);
    if (result.ok) setHandoffs(result.data.handoffs);
    else setErr(result.error?.message ?? 'handoff list failed');
  }, []);

  useEffect(() => {
    void refresh();
    if (!window.kodaxSpace) return;
    const unsub = window.kodaxSpace.on('handoff.changed', (payload) => {
      setHandoffs(payload.handoffs);
    });
    return () => unsub();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  async function accept(handoff: HandoffFileT): Promise<void> {
    if (!window.kodaxSpace) return;
    setErr(null);
    if (!handoff.sessionId || !handoff.projectRoot) {
      setErr(handoff.error ?? 'handoff is missing a session or project');
      await refresh();
      return;
    }

    const listed = await window.kodaxSpace.invoke('session.list', {
      projectRoot: handoff.projectRoot,
      surface: 'code',
    });
    if (!listed.ok) {
      setErr(listed.error?.message ?? 'session list failed');
      await refresh();
      return;
    }
    const found = listed.data.sessions.find((s) => s.sessionId === handoff.sessionId);
    if (!found) {
      setErr(`Session ${handoff.sessionId} was not found on disk; handoff was kept.`);
      await refresh();
      return;
    }

    const accepted = await window.kodaxSpace.invoke('handoff.accept', {
      handoffId: handoff.id,
      expectedSessionId: handoff.sessionId,
    });
    if (!accepted.ok || !accepted.data.accepted || !accepted.data.sessionId) {
      setErr(accepted.ok ? (accepted.data.error ?? 'handoff rejected') : accepted.error.message);
      await refresh();
      return;
    }
    if (accepted.data.sessionId !== handoff.sessionId) {
      setErr(`Handoff changed before accept: ${accepted.data.sessionId}`);
      await refresh();
      return;
    }

    for (const session of listed.data.sessions) upsertSession(session);
    setCurrentSession(found.sessionId);
    if (!accepted.data.removed) {
      setErr(accepted.data.error ?? 'accepted but failed to remove handoff file');
      await refresh();
      return;
    }
    setOpen(false);
    await refresh();
  }

  async function dismiss(handoff: HandoffFileT): Promise<void> {
    if (!window.kodaxSpace) return;
    setErr(null);
    const result = await window.kodaxSpace.invoke('handoff.dismiss', { handoffId: handoff.id });
    if (!result.ok || !result.data.dismissed) {
      setErr(result.ok ? (result.data.error ?? 'dismiss failed') : result.error.message);
    }
    await refresh();
  }

  if (handoffs.length === 0) return null;

  const validCount = handoffs.filter((handoff) => handoff.status === 'valid').length;

  return (
    <div className="relative app-no-drag" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-default bg-surface-2 px-2 text-[11px] font-mono text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
        title="Incoming handoffs"
        aria-label="Incoming handoffs"
      >
        <Inbox className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        <span>{validCount}/{handoffs.length}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[min(420px,calc(100vw-24px))] rounded-lg border border-border-default bg-surface/95 p-2 text-xs text-fg-secondary shadow-2xl backdrop-blur-xl">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="font-semibold text-fg-primary">Incoming Handoffs</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
              aria-label="Close handoffs"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          {err && <div className="mb-2 rounded border border-danger/40 bg-danger/10 px-2 py-1 text-danger">{err}</div>}
          <div className="max-h-72 space-y-1 overflow-auto">
            {handoffs.map((handoff) => (
              <div key={handoff.id} className="rounded-md border border-border-default bg-surface-2 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-fg-primary">
                      {handoff.sessionId ?? handoff.id}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-fg-muted">
                      {handoff.projectRoot ?? handoff.error ?? handoff.filePath}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase text-fg-faint">
                      {handoff.status}
                      {handoff.source ? ` / ${handoff.source}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    <button
                      type="button"
                      disabled={handoff.status !== 'valid'}
                      onClick={() => void accept(handoff)}
                      className="rounded border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] text-ok hover:bg-ok/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => void dismiss(handoff)}
                      className="rounded border border-border-default px-2 py-0.5 text-[11px] text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
                {handoff.error && (
                  <div className="mt-1 text-[11px] text-danger">{handoff.error}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
