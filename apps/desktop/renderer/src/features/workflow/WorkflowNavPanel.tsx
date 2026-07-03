import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  ExternalLink,
  Loader2,
  Pause,
  PauseCircle,
  Pencil,
  Play,
  PlayCircle,
  RefreshCw,
  Square,
  Trash2,
  Workflow,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type {
  ChannelOutput,
  IpcResult,
  WorkflowProcessStatusT,
  WorkflowRunT,
} from '@kodax-space/space-ipc-schema';
import { useSurfaceStore } from '../../store/surface.js';
import { useAppStore } from '../../store/appStore.js';
import { pushToast } from '../../store/toastStore.js';
import { requestConfirm } from '../../store/confirmStore.js';
import {
  selectableWorkflowRunSessionId,
  workflowRerunSessionId,
  workflowRunBelongsToProject,
} from './workflowManagementModel.js';

type WorkflowLibrary = ChannelOutput<'workflow.library'>;
type SavedWorkflow = WorkflowLibrary['saved'][number];

const STATUS_ICON: Record<WorkflowProcessStatusT, LucideIcon> = {
  running: Loader2,
  paused: PauseCircle,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: CircleSlash,
};
const STATUS_COLOR: Record<WorkflowProcessStatusT, string> = {
  running: 'text-warn',
  paused: 'text-fg-muted',
  completed: 'text-ok',
  failed: 'text-danger',
  cancelled: 'text-fg-faint',
};
const STATUS_RANK: Record<WorkflowProcessStatusT, number> = {
  running: 0,
  paused: 1,
  failed: 2,
  completed: 3,
  cancelled: 4,
};

export function WorkflowNavPanel(): JSX.Element | null {
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workflowRuns = useAppStore((s) => s.workflowRuns);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const seedWorkflowRuns = useAppStore((s) => s.seedWorkflowRuns);
  const requestPopout = useAppStore((s) => s.requestPopout);
  const currentSurface = useSurfaceStore((s) => s.currentSurface);
  const [open, setOpen] = useState(true);
  const [library, setLibrary] = useState<WorkflowLibrary | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  // #2 fix: window.prompt 在 Electron sandbox=true 下是静默 no-op（不会真弹窗，rename 悄悄失败）。
  // 改用 inline 输入替换行内标签，镜像 SessionList.tsx / SessionContextMenu.tsx 的
  // renaming(id) + draft 模式：Enter 提交，Esc/blur 取消。
  const [renamingRunId, setRenamingRunId] = useState<string | null>(null);
  const [renamingSavedKey, setRenamingSavedKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const projectSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if ((session.surface ?? 'code') !== currentSurface) continue;
      if (currentProjectPath && session.projectRoot !== currentProjectPath) continue;
      ids.add(session.sessionId);
    }
    return ids;
  }, [currentProjectPath, currentSurface, sessions]);

  const runs = useMemo(() => {
    return Object.values(workflowRuns)
      .filter((run) =>
        workflowRunBelongsToProject({
          run,
          currentProjectPath,
          currentSessionId,
          currentSurface,
          projectSessionIds,
        }),
      )
      .sort(sortWorkflowRuns);
  }, [currentProjectPath, currentSessionId, currentSurface, projectSessionIds, workflowRuns]);

  useEffect(() => {
    if (!open || !currentProjectPath) {
      setLibrary(null);
      return;
    }
    let cancelled = false;
    setLoadingLibrary(true);
    void window.kodaxSpace
      ?.invoke('workflow.library', { projectRoot: currentProjectPath })
      .then((result) => {
        if (cancelled) return;
        setLibrary(result.ok ? result.data : null);
      })
      .catch(() => {
        if (!cancelled) setLibrary(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingLibrary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectPath, open, refreshNonce]);

  const refreshWorkflowRuns = useCallback(() => {
    if (!currentProjectPath) return;
    void window.kodaxSpace
      ?.invoke('workflow.list', undefined)
      .then((result) => {
        if (result.ok) seedWorkflowRuns(result.data.runs);
      })
      .catch(() => {});
  }, [currentProjectPath, seedWorkflowRuns]);

  useEffect(() => {
    if (!open) return;
    refreshWorkflowRuns();
  }, [open, refreshNonce, refreshWorkflowRuns]);

  const refreshLibrary = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  const openWorkflowPanel = useCallback(
    (sessionId?: string) => {
      if (sessionId && projectSessionIds.has(sessionId)) setCurrentSession(sessionId);
      requestPopout('workflow');
    },
    [projectSessionIds, requestPopout, setCurrentSession],
  );

  function startRenameRun(run: WorkflowRunT): void {
    setRenamingSavedKey(null);
    setRenamingRunId(run.runId);
    setRenameDraft(run.displayName ?? run.workflowName);
  }

  async function commitRenameRun(run: WorkflowRunT): Promise<void> {
    const current = run.displayName ?? run.workflowName;
    const next = renameDraft.trim();
    setRenamingRunId(null);
    if (!next || next === current) return;
    await invokeWorkflowControl(
      window.kodaxSpace?.invoke('workflow.rename', { runId: run.runId, displayName: next }),
      `Rename failed: ${current}`,
    );
  }

  function startRenameSaved(saved: SavedWorkflow): void {
    setRenamingRunId(null);
    setRenamingSavedKey(`${saved.source ?? 'saved'}:${saved.name}`);
    setRenameDraft(saved.name);
  }

  async function commitRenameSaved(saved: SavedWorkflow, sessionId: string | null): Promise<void> {
    const next = renameDraft.trim();
    setRenamingSavedKey(null);
    if (!next || next === saved.name) return;
    if (!sessionId) {
      pushToast('Open a session before editing saved workflows', 'warning');
      return;
    }
    const result = await invokeWorkflowControl(
      window.kodaxSpace?.invoke('workflow.saved.rename', {
        name: saved.name,
        newName: next,
        sessionId,
        source: saved.source,
      }),
      `Rename failed: ${saved.name}`,
    );
    if (result) {
      pushToast(`Saved workflow renamed: ${next}`, 'success');
      refreshLibrary();
    }
  }

  function cancelRename(): void {
    setRenamingRunId(null);
    setRenamingSavedKey(null);
    setRenameDraft('');
  }

  if (!currentProjectPath) return null;

  const saved = library?.saved ?? [];
  const runningCount = runs.filter(
    (run) => run.status === 'running' || run.status === 'paused',
  ).length;
  const shownRuns = runs.slice(0, 4);
  const shownSaved = saved.slice(0, 4);

  return (
    <div className="rounded-md border border-border-default/60 bg-surface-2/40 overflow-hidden">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex-1 min-w-0 px-2 py-1.5 flex items-center gap-2 text-xs text-fg-primary hover:bg-hover-bg"
          aria-expanded={open}
        >
          <Workflow
            className="w-4 h-4 flex-shrink-0 text-fg-muted"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="truncate">Workflow</span>
          <span className="ml-auto text-[10px] font-mono text-fg-faint tabular-nums">
            {runningCount > 0 ? `${runningCount} live` : `${runs.length} runs`}
          </span>
          <ChevronDown
            className={`w-3 h-3 flex-shrink-0 text-fg-muted transition-transform ${open ? '' : '-rotate-90'}`}
            strokeWidth={2}
            aria-hidden
          />
        </button>
        <IconButton
          label="Open workflow panel"
          onClick={() => openWorkflowPanel(currentSessionId ?? undefined)}
        >
          <ExternalLink size={12} />
        </IconButton>
      </div>

      {open && (
        <div className="px-1.5 pb-1.5 space-y-1.5">
          <div>
            <div className="px-1 py-0.5 text-[10px] uppercase tracking-wider text-fg-faint">
              Runs
            </div>
            {shownRuns.length === 0 ? (
              <div className="px-1.5 py-1 text-[11px] text-fg-faint">No workflow runs.</div>
            ) : (
              <ul className="space-y-0.5">
                {shownRuns.map((run) => (
                  <WorkflowRunNavRow
                    key={run.runId}
                    run={run}
                    currentSessionId={currentSessionId}
                    projectSessionIds={projectSessionIds}
                    onOpen={() =>
                      openWorkflowPanel(selectableWorkflowRunSessionId(run, projectSessionIds))
                    }
                    renaming={renamingRunId === run.runId}
                    renameDraft={renameDraft}
                    onRenameDraftChange={setRenameDraft}
                    onStartRename={() => startRenameRun(run)}
                    onCommitRename={() => void commitRenameRun(run)}
                    onCancelRename={cancelRename}
                  />
                ))}
                {runs.length > shownRuns.length && (
                  <li className="px-1.5 py-0.5 text-[10px] text-fg-faint font-mono">
                    +{runs.length - shownRuns.length} more
                  </li>
                )}
              </ul>
            )}
          </div>

          <div>
            <div className="px-1 py-0.5 flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wider text-fg-faint">Saved</span>
              <button
                type="button"
                onClick={refreshLibrary}
                className="ml-auto w-5 h-5 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
                title="Refresh workflows"
                aria-label="Refresh workflows"
              >
                <RefreshCw
                  className={`w-3 h-3 ${loadingLibrary ? 'animate-spin' : ''}`}
                  strokeWidth={2}
                />
              </button>
            </div>
            {shownSaved.length === 0 ? (
              <div className="px-1.5 py-1 text-[11px] text-fg-faint">
                {loadingLibrary ? 'Loading workflows...' : 'No saved workflows.'}
              </div>
            ) : (
              <ul className="space-y-0.5">
                {shownSaved.map((savedWorkflow) => (
                  <SavedWorkflowNavRow
                    key={`${savedWorkflow.source ?? 'saved'}:${savedWorkflow.name}`}
                    saved={savedWorkflow}
                    sessionId={currentSessionId}
                    onChanged={refreshLibrary}
                    renaming={
                      renamingSavedKey === `${savedWorkflow.source ?? 'saved'}:${savedWorkflow.name}`
                    }
                    renameDraft={renameDraft}
                    onRenameDraftChange={setRenameDraft}
                    onStartRename={() => startRenameSaved(savedWorkflow)}
                    onCommitRename={() => void commitRenameSaved(savedWorkflow, currentSessionId)}
                    onCancelRename={cancelRename}
                  />
                ))}
                {saved.length > shownSaved.length && (
                  <li className="px-1.5 py-0.5 text-[10px] text-fg-faint font-mono">
                    +{saved.length - shownSaved.length} more
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowRunNavRow({
  run,
  currentSessionId,
  projectSessionIds,
  onOpen,
  renaming,
  renameDraft,
  onRenameDraftChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: {
  run: WorkflowRunT;
  currentSessionId: string | null;
  projectSessionIds: ReadonlySet<string>;
  onOpen: () => void;
  renaming: boolean;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}): JSX.Element {
  const Icon = STATUS_ICON[run.status];
  const active = run.status === 'running' || run.status === 'paused';
  const terminal =
    run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
  const name = run.displayName ?? run.workflowName;

  return (
    <li className="group flex items-center gap-1 rounded px-1 py-1 hover:bg-hover-bg min-w-0">
      <Icon
        className={`w-3.5 h-3.5 flex-shrink-0 ${STATUS_COLOR[run.status]} ${run.status === 'running' ? 'animate-spin' : ''}`}
        strokeWidth={2}
        aria-hidden
      />
      {renaming ? (
        <input
          type="text"
          autoFocus
          value={renameDraft}
          onChange={(e) => onRenameDraftChange(e.target.value)}
          onBlur={onCommitRename}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') onCommitRename();
            else if (e.key === 'Escape') onCancelRename();
          }}
          maxLength={256}
          className="min-w-0 flex-1 bg-surface border border-border-strong rounded px-1 py-0 text-[11px] text-fg-primary"
          aria-label="Rename workflow run"
        />
      ) : (
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[11px] text-fg-secondary" title={name}>
            {name}
          </div>
          <div
            className="truncate text-[10px] font-mono text-fg-faint"
            title={run.latestMessage ?? run.status}
          >
            {run.latestMessage ?? run.status}
          </div>
        </button>
      )}
      {!renaming && (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <IconButton
            label="Run again"
            onClick={() => void rerunWorkflow(run, currentSessionId, projectSessionIds)}
          >
            <PlayCircle size={11} />
          </IconButton>
          {run.status === 'running' && (
            <IconButton label="Pause" onClick={() => void pauseWorkflow(run.runId, name)}>
              <Pause size={11} />
            </IconButton>
          )}
          {run.status === 'paused' && (
            <IconButton label="Resume" onClick={() => void resumeWorkflow(run.runId, name)}>
              <Play size={11} />
            </IconButton>
          )}
          {active && (
            <IconButton label="Stop" danger onClick={() => void stopWorkflow(run.runId, name)}>
              <Square size={11} />
            </IconButton>
          )}
          <IconButton label="Rename" onClick={onStartRename}>
            <Pencil size={11} />
          </IconButton>
          {terminal && (
            <IconButton label="Delete" danger onClick={() => void deleteWorkflowRun(run)}>
              <Trash2 size={11} />
            </IconButton>
          )}
        </div>
      )}
    </li>
  );
}

function SavedWorkflowNavRow({
  saved,
  sessionId,
  onChanged,
  renaming,
  renameDraft,
  onRenameDraftChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: {
  saved: SavedWorkflow;
  sessionId: string | null;
  onChanged: () => void;
  renaming: boolean;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}): JSX.Element {
  return (
    <li className="group flex items-center gap-1 rounded px-1 py-1 hover:bg-hover-bg min-w-0">
      <Play className="w-3.5 h-3.5 flex-shrink-0 text-fg-muted" strokeWidth={2} aria-hidden />
      {renaming ? (
        <input
          type="text"
          autoFocus
          value={renameDraft}
          onChange={(e) => onRenameDraftChange(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitRename();
            else if (e.key === 'Escape') onCancelRename();
          }}
          maxLength={256}
          className="min-w-0 flex-1 bg-surface border border-border-strong rounded px-1 py-0 text-[11px] text-fg-primary"
          aria-label="Rename saved workflow"
        />
      ) : (
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-fg-secondary" title={saved.name}>
            {saved.name}
          </div>
          <div
            className="truncate text-[10px] font-mono text-fg-faint"
            title={saved.source ?? saved.path}
          >
            {saved.source ?? 'saved'}
          </div>
        </div>
      )}
      {!renaming && (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <IconButton label="Run" onClick={() => void startSavedWorkflow(saved, sessionId)}>
            <Play size={11} />
          </IconButton>
          <IconButton label="Rename" onClick={onStartRename}>
            <Pencil size={11} />
          </IconButton>
          <IconButton
            label="Delete"
            danger
            onClick={() => void deleteSavedWorkflow(saved, sessionId, onChanged)}
          >
            <Trash2 size={11} />
          </IconButton>
        </div>
      )}
    </li>
  );
}

function IconButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
      className={`w-5 h-5 inline-flex items-center justify-center rounded text-fg-muted hover:bg-surface-3 ${
        danger ? 'hover:text-danger' : 'hover:text-fg-primary'
      }`}
    >
      {children}
    </button>
  );
}

// #13 fix: control actions are fire-and-forget IPC — the async result can land after the
// user has switched to a different run/session. Every toast below names the run so a
// "failed"/"succeeded" toast is never ambiguous about which run it refers to.
async function pauseWorkflow(runId: string, name: string): Promise<void> {
  await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.pause', { runId }),
    `Pause failed: ${name}`,
  );
}

async function resumeWorkflow(runId: string, name: string): Promise<void> {
  await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.resume', { runId }),
    `Resume failed: ${name}`,
  );
}

async function stopWorkflow(runId: string, name: string): Promise<void> {
  await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.stop', { runId, reason: 'stopped from workflow panel' }),
    `Stop failed: ${name}`,
  );
}

async function rerunWorkflow(
  run: WorkflowRunT,
  currentSessionId: string | null,
  projectSessionIds: ReadonlySet<string>,
): Promise<void> {
  const name = run.displayName ?? run.workflowName;
  const sessionId = workflowRerunSessionId({ run, currentSessionId, projectSessionIds });
  if (!sessionId) {
    pushToast('Open a session before rerunning a workflow', 'warning');
    return;
  }
  const result = await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.rerun', { runId: run.runId, sessionId }),
    `Rerun failed: ${name}`,
  );
  if (result) pushToast(`Workflow rerun started: ${name}`, 'success');
}

async function deleteWorkflowRun(run: WorkflowRunT): Promise<void> {
  const name = run.displayName ?? run.workflowName;
  // #1 fix: window.confirm 在 Electron sandbox=true 下会夺走 webContents 键盘焦点且拿不回来
  // ——改用应用内 requestConfirm。
  const confirmed = await requestConfirm({
    message: `Delete workflow run "${name}"?`,
    danger: true,
    confirmLabel: 'Delete',
  });
  if (!confirmed) return;
  const result = await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.delete', { runId: run.runId }),
    `Delete failed: ${name}`,
  );
  if (result) pushToast(`Workflow run deleted: ${name}`, 'success');
}

async function startSavedWorkflow(saved: SavedWorkflow, sessionId: string | null): Promise<void> {
  if (!sessionId) {
    pushToast('Open a session before running a workflow', 'warning');
    return;
  }
  const result = await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.start', {
      target: saved.path,
      source: 'saved',
      sessionId,
    }),
    `Start failed: ${saved.name}`,
  );
  if (result) pushToast(`Workflow started: ${saved.name}`, 'success');
}

async function deleteSavedWorkflow(
  saved: SavedWorkflow,
  sessionId: string | null,
  onChanged: () => void,
): Promise<void> {
  if (!sessionId) {
    pushToast('Open a session before editing saved workflows', 'warning');
    return;
  }
  // #1 fix: window.confirm 在 Electron sandbox=true 下会夺走 webContents 键盘焦点且拿不回来
  // ——改用应用内 requestConfirm。
  const confirmed = await requestConfirm({
    message: `Delete saved workflow "${saved.name}"?`,
    danger: true,
    confirmLabel: 'Delete',
  });
  if (!confirmed) return;
  const result = await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.saved.delete', {
      name: saved.name,
      sessionId,
      source: saved.source,
    }),
    `Delete failed: ${saved.name}`,
  );
  if (result) {
    pushToast(`Saved workflow deleted: ${saved.name}`, 'success');
    onChanged();
  }
}

async function invokeWorkflowControl<T>(
  action: Promise<IpcResult<T>> | undefined,
  fallback: string,
): Promise<T | null> {
  if (!action) {
    pushToast(fallback, 'error');
    return null;
  }
  try {
    const result = await action;
    if (!result.ok) {
      pushToast(result.error.message || fallback, 'error');
      return null;
    }
    const data = result.data as T & { error?: string; ok?: boolean };
    if (data.error) {
      pushToast(data.error, 'error');
      return null;
    }
    if (data.ok === false) {
      pushToast(fallback, 'warning');
      return null;
    }
    return result.data;
  } catch (err) {
    pushToast(err instanceof Error ? err.message : fallback, 'error');
    return null;
  }
}

function sortWorkflowRuns(a: WorkflowRunT, b: WorkflowRunT): number {
  const status = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (status !== 0) return status;
  return b.updatedAt.localeCompare(a.updatedAt);
}
