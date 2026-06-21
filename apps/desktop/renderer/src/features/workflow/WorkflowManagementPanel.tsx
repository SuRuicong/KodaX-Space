import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleSlash,
  Clock3,
  FileCode2,
  Loader2,
  Pause,
  PauseCircle,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  Workflow,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type {
  IpcResult,
  WorkflowProcessStatusT,
  WorkflowRunT,
} from '@kodax-space/space-ipc-schema';
import { useSurfaceStore } from '../../store/surface.js';
import { useAppStore } from '../../store/appStore.js';
import { pushToast } from '../../store/toastStore.js';
import { WorkflowLauncher } from './WorkflowLauncher.js';
import { WorkflowPanel } from './WorkflowPanel.js';
import { workflowPhaseLabel } from './workflowPhaseDisplay.js';
import {
  chooseWorkflowManagementSelection,
  relatedRunsForSavedWorkflow,
  savedWorkflowKey,
  sortWorkflowRunsForManagement,
  workflowRunTitle,
  type SavedWorkflowRef,
  type WorkflowLibrary,
  type WorkflowManagementSelection,
} from './workflowManagementModel.js';

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

export function WorkflowManagementPanel(): JSX.Element {
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workflowRuns = useAppStore((s) => s.workflowRuns);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const currentSurface = useSurfaceStore((s) => s.currentSurface);

  const [library, setLibrary] = useState<WorkflowLibrary | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selection, setSelection] = useState<WorkflowManagementSelection | null>(null);

  const projectSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if ((session.surface ?? 'code') !== currentSurface) continue;
      if (currentProjectPath && session.projectRoot !== currentProjectPath) continue;
      ids.add(session.sessionId);
    }
    return ids;
  }, [currentProjectPath, currentSurface, sessions]);

  const runs = useMemo(
    () =>
      sortWorkflowRunsForManagement(
        Object.values(workflowRuns).filter(
          (run) => run.sessionId !== undefined && projectSessionIds.has(run.sessionId),
        ),
      ),
    [projectSessionIds, workflowRuns],
  );
  const saved = library?.saved ?? [];
  const activeRuns = runs.filter((run) => run.status === 'running' || run.status === 'paused');
  const selectedRun =
    selection?.kind === 'run' ? runs.find((run) => run.runId === selection.id) : undefined;
  const selectedSaved =
    selection?.kind === 'saved'
      ? saved.find((item) => savedWorkflowKey(item) === selection.key)
      : undefined;
  const selectedSavedRuns = selectedSaved ? relatedRunsForSavedWorkflow(selectedSaved, runs) : [];

  useEffect(() => {
    if (!currentProjectPath) {
      setLibrary(null);
      return;
    }
    let cancelled = false;
    setLoadingLibrary(true);
    void window.kodaxSpace
      ?.invoke('workflow.library', { projectRoot: currentProjectPath })
      .then((result) => {
        if (!cancelled) setLibrary(result.ok ? result.data : null);
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
  }, [currentProjectPath, refreshNonce]);

  useEffect(() => {
    setSelection((current) =>
      chooseWorkflowManagementSelection({
        current,
        runs,
        saved,
        currentSessionId,
      }),
    );
  }, [runs, saved, currentSessionId]);

  const selectRun = useCallback(
    (run: WorkflowRunT) => {
      if (run.sessionId) setCurrentSession(run.sessionId);
      setSelection({ kind: 'run', id: run.runId });
    },
    [setCurrentSession],
  );

  const refreshLibrary = useCallback(() => setRefreshNonce((value) => value + 1), []);

  return (
    <div className="h-full min-h-0 flex flex-col" data-testid="workflow-management-panel">
      <div className="flex items-center gap-3 border-b border-border-default/60 px-3 py-2 flex-shrink-0">
        <Workflow className="h-4 w-4 text-fg-muted" strokeWidth={1.8} aria-hidden />
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-fg-primary">Workflow manager</div>
          <div className="text-[10px] font-mono text-fg-faint truncate">
            {activeRuns.length} live / {runs.length} runs / {saved.length} saved
          </div>
        </div>
        <button
          type="button"
          onClick={refreshLibrary}
          className="ml-auto h-7 w-7 inline-flex items-center justify-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg-primary"
          title="Refresh workflow library"
          aria-label="Refresh workflow library"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingLibrary ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-border-default/60 bg-surface/30 p-2">
          <WorkflowLauncher />
          <ManagementSection title="Runs" count={runs.length}>
            {runs.length === 0 ? (
              <EmptyLine>No workflow runs.</EmptyLine>
            ) : (
              <ul className="space-y-1">
                {runs.map((run) => (
                  <RunListItem
                    key={run.runId}
                    run={run}
                    active={selection?.kind === 'run' && selection.id === run.runId}
                    onSelect={() => selectRun(run)}
                  />
                ))}
              </ul>
            )}
          </ManagementSection>

          <ManagementSection title="Saved" count={saved.length}>
            {saved.length === 0 ? (
              <EmptyLine>{loadingLibrary ? 'Loading workflows...' : 'No saved workflows.'}</EmptyLine>
            ) : (
              <ul className="space-y-1">
                {saved.map((item) => {
                  const key = savedWorkflowKey(item);
                  return (
                    <SavedListItem
                      key={key}
                      saved={item}
                      active={selection?.kind === 'saved' && selection.key === key}
                      onSelect={() => setSelection({ kind: 'saved', key })}
                    />
                  );
                })}
              </ul>
            )}
          </ManagementSection>
        </aside>

        <main className="min-h-0 overflow-y-auto p-3" data-testid="workflow-management-detail">
          {selectedRun ? (
            <RunDetail run={selectedRun} relatedRuns={runs} onSelectRun={selectRun} />
          ) : selectedSaved ? (
            <SavedDetail
              saved={selectedSaved}
              relatedRuns={selectedSavedRuns}
              currentSessionId={currentSessionId}
              onSelectRun={selectRun}
              onChanged={refreshLibrary}
            />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>
    </div>
  );
}

function ManagementSection({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="mt-3 first:mt-0">
      <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-mono uppercase tracking-wider text-fg-faint">
        <span>{title}</span>
        <span>{count}</span>
      </div>
      {children}
    </section>
  );
}

function RunListItem({
  run,
  active,
  onSelect,
}: {
  readonly run: WorkflowRunT;
  readonly active: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  const Icon = STATUS_ICON[run.status];
  const title = workflowRunTitle(run);
  const phase = workflowPhaseLabel(run);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`w-full rounded-md border px-2 py-1.5 text-left transition-colors ${
          active
            ? 'border-run/60 bg-run/15'
            : 'border-border-default/40 bg-surface-2/50 hover:bg-hover-bg'
        }`}
        title={title}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon
            className={`h-3.5 w-3.5 flex-shrink-0 ${STATUS_COLOR[run.status]} ${
              run.status === 'running' ? 'animate-spin' : ''
            }`}
            strokeWidth={2}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-fg-primary">
            {title}
          </span>
          <span className="flex-shrink-0 text-[9px] font-mono text-fg-faint">{run.status}</span>
        </div>
        <div className="mt-0.5 truncate text-[10px] font-mono text-fg-faint">
          {phase ?? run.latestMessage ?? shortRunId(run.runId)}
        </div>
      </button>
    </li>
  );
}

function SavedListItem({
  saved,
  active,
  onSelect,
}: {
  readonly saved: SavedWorkflowRef;
  readonly active: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`w-full rounded-md border px-2 py-1.5 text-left transition-colors ${
          active
            ? 'border-accent/55 bg-accent/10'
            : 'border-border-default/40 bg-surface-2/50 hover:bg-hover-bg'
        }`}
        title={saved.path}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <FileCode2
            className="h-3.5 w-3.5 flex-shrink-0 text-fg-muted"
            strokeWidth={1.8}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-fg-primary">
            {saved.name}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[10px] font-mono text-fg-faint">
          {saved.source ?? saved.execution ?? 'saved'}
        </div>
      </button>
    </li>
  );
}

function RunDetail({
  run,
  relatedRuns,
  onSelectRun,
}: {
  readonly run: WorkflowRunT;
  readonly relatedRuns: readonly WorkflowRunT[];
  readonly onSelectRun: (run: WorkflowRunT) => void;
}): JSX.Element {
  const title = workflowRunTitle(run);
  return (
    <div className="space-y-3">
      <DetailHeader
        icon={<Workflow className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
        title={title}
        subtitle={`${run.status} / ${shortRunId(run.runId)}`}
      >
        <RunActions run={run} />
      </DetailHeader>
      <WorkflowPanel runs={[run]} variant="full" />
      <HistoryBlock runs={relatedRuns} selectedRunId={run.runId} onSelectRun={onSelectRun} />
    </div>
  );
}

function SavedDetail({
  saved,
  relatedRuns,
  currentSessionId,
  onSelectRun,
  onChanged,
}: {
  readonly saved: SavedWorkflowRef;
  readonly relatedRuns: readonly WorkflowRunT[];
  readonly currentSessionId: string | null;
  readonly onSelectRun: (run: WorkflowRunT) => void;
  readonly onChanged: () => void;
}): JSX.Element {
  const latestRun = relatedRuns[0];
  return (
    <div className="space-y-3">
      <DetailHeader
        icon={<FileCode2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
        title={saved.name}
        subtitle={saved.source ?? saved.execution ?? 'saved workflow'}
      >
        <SavedActions saved={saved} currentSessionId={currentSessionId} onChanged={onChanged} />
      </DetailHeader>

      <div className="rounded-md border border-border-default/60 bg-surface-2/60 p-2">
        <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-fg-faint">
          Capsule
        </div>
        <div className="break-all text-[11px] font-mono text-fg-secondary">{saved.path}</div>
      </div>

      {latestRun ? (
        <>
          <div>
            <div className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-fg-faint">
              Latest runtime graph
            </div>
            <WorkflowPanel runs={[latestRun]} variant="full" />
          </div>
          <HistoryBlock
            runs={relatedRuns}
            selectedRunId={latestRun.runId}
            onSelectRun={onSelectRun}
          />
        </>
      ) : (
        <div className="rounded-md border border-dashed border-border-default/70 bg-surface-2/35 p-3 text-xs text-fg-muted">
          No runtime graph or execution history yet.
        </div>
      )}
    </div>
  );
}

function DetailHeader({
  icon,
  title,
  subtitle,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly subtitle: string;
  readonly children?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-start gap-2 border-b border-border-default/50 pb-2">
      <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-border-default/60 bg-surface-2 text-fg-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-fg-primary" title={title}>
          {title}
        </div>
        <div className="mt-0.5 truncate text-[10px] font-mono text-fg-faint" title={subtitle}>
          {subtitle}
        </div>
      </div>
      {children && <div className="flex flex-shrink-0 items-center gap-1">{children}</div>}
    </div>
  );
}

function RunActions({ run }: { readonly run: WorkflowRunT }): JSX.Element {
  const active = run.status === 'running' || run.status === 'paused';
  const terminal =
    run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
  return (
    <>
      <ActionButton label="Rerun" onClick={() => void rerunWorkflow(run)}>
        <RotateCcw size={13} />
      </ActionButton>
      {run.status === 'running' && (
        <ActionButton label="Pause" onClick={() => void pauseWorkflow(run.runId)}>
          <Pause size={13} />
        </ActionButton>
      )}
      {run.status === 'paused' && (
        <ActionButton label="Resume" onClick={() => void resumeWorkflow(run.runId)}>
          <Play size={13} />
        </ActionButton>
      )}
      {active && (
        <ActionButton label="Stop" danger onClick={() => void stopWorkflow(run.runId)}>
          <Square size={13} />
        </ActionButton>
      )}
      <ActionButton label="Rename" onClick={() => void renameWorkflowRun(run)}>
        <Pencil size={13} />
      </ActionButton>
      {terminal && (
        <ActionButton label="Delete" danger onClick={() => void deleteWorkflowRun(run)}>
          <Trash2 size={13} />
        </ActionButton>
      )}
    </>
  );
}

function SavedActions({
  saved,
  currentSessionId,
  onChanged,
}: {
  readonly saved: SavedWorkflowRef;
  readonly currentSessionId: string | null;
  readonly onChanged: () => void;
}): JSX.Element {
  return (
    <>
      <ActionButton label="Run" onClick={() => void startSavedWorkflow(saved, currentSessionId)}>
        <Play size={13} />
      </ActionButton>
      <ActionButton
        label="Rename"
        onClick={() => void renameSavedWorkflow(saved, currentSessionId, onChanged)}
      >
        <Pencil size={13} />
      </ActionButton>
      <ActionButton
        label="Delete"
        danger
        onClick={() => void deleteSavedWorkflow(saved, currentSessionId, onChanged)}
      >
        <Trash2 size={13} />
      </ActionButton>
    </>
  );
}

function ActionButton({
  label,
  danger,
  onClick,
  children,
}: {
  readonly label: string;
  readonly danger?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-border-default/50 text-fg-muted hover:bg-surface-3 ${
        danger ? 'hover:text-danger' : 'hover:text-fg-primary'
      }`}
    >
      {children}
    </button>
  );
}

function HistoryBlock({
  runs,
  selectedRunId,
  onSelectRun,
}: {
  readonly runs: readonly WorkflowRunT[];
  readonly selectedRunId?: string;
  readonly onSelectRun: (run: WorkflowRunT) => void;
}): JSX.Element | null {
  if (runs.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-fg-faint">
        <Clock3 className="h-3 w-3" strokeWidth={1.8} aria-hidden />
        <span>Execution history</span>
      </div>
      <ul className="space-y-1">
        {runs.slice(0, 12).map((run) => (
          <HistoryRow
            key={run.runId}
            run={run}
            active={run.runId === selectedRunId}
            onSelect={() => onSelectRun(run)}
          />
        ))}
      </ul>
    </div>
  );
}

function HistoryRow({
  run,
  active,
  onSelect,
}: {
  readonly run: WorkflowRunT;
  readonly active: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  const Icon = STATUS_ICON[run.status];
  const title = workflowRunTitle(run);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-1.5 text-left ${
          active
            ? 'border-run/55 bg-run/10'
            : 'border-border-default/40 bg-surface-2/45 hover:bg-hover-bg'
        }`}
      >
        <Icon
          className={`h-3.5 w-3.5 ${STATUS_COLOR[run.status]} ${
            run.status === 'running' ? 'animate-spin' : ''
          }`}
          strokeWidth={2}
          aria-hidden
        />
        <span className="truncate text-[11px] text-fg-secondary" title={title}>
          {title}
        </span>
        <span className="text-[10px] font-mono text-fg-faint">{run.status}</span>
      </button>
    </li>
  );
}

function EmptyLine({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return <div className="px-1 py-1 text-[11px] text-fg-faint">{children}</div>;
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex h-full min-h-[220px] items-center justify-center rounded-md border border-dashed border-border-default/60 text-xs text-fg-muted">
      No workflow selected.
    </div>
  );
}

async function pauseWorkflow(runId: string): Promise<void> {
  await invokeWorkflowControl(window.kodaxSpace?.invoke('workflow.pause', { runId }), 'Pause failed');
}

async function resumeWorkflow(runId: string): Promise<void> {
  await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.resume', { runId }),
    'Resume failed',
  );
}

async function stopWorkflow(runId: string): Promise<void> {
  await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.stop', { runId, reason: 'stopped from workflow manager' }),
    'Stop failed',
  );
}

async function rerunWorkflow(run: WorkflowRunT): Promise<void> {
  if (!run.sessionId) {
    pushToast('Workflow run has no owning session', 'warning');
    return;
  }
  const result = await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.rerun', { runId: run.runId, sessionId: run.sessionId }),
    'Rerun failed',
  );
  if (result) pushToast('Workflow rerun started', 'success');
}

async function renameWorkflowRun(run: WorkflowRunT): Promise<void> {
  const current = workflowRunTitle(run);
  const next = window.prompt('Rename workflow run', current)?.trim();
  if (!next || next === current) return;
  await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.rename', { runId: run.runId, displayName: next }),
    'Rename failed',
  );
}

async function deleteWorkflowRun(run: WorkflowRunT): Promise<void> {
  if (!window.confirm(`Delete workflow run "${workflowRunTitle(run)}"?`)) return;
  const result = await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.delete', { runId: run.runId }),
    'Delete failed',
  );
  if (result) pushToast('Workflow run deleted', 'success');
}

async function startSavedWorkflow(
  saved: SavedWorkflowRef,
  currentSessionId: string | null,
): Promise<void> {
  if (!currentSessionId) {
    pushToast('Open a session before running a workflow', 'warning');
    return;
  }
  const result = await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.start', {
      target: saved.path,
      source: 'saved',
      sessionId: currentSessionId,
    }),
    'Start failed',
  );
  if (result) pushToast('Workflow started', 'success');
}

async function renameSavedWorkflow(
  saved: SavedWorkflowRef,
  currentSessionId: string | null,
  onChanged: () => void,
): Promise<void> {
  if (!currentSessionId) {
    pushToast('Open a session before editing saved workflows', 'warning');
    return;
  }
  const next = window.prompt('Rename saved workflow', saved.name)?.trim();
  if (!next || next === saved.name) return;
  const result = await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.saved.rename', {
      name: saved.name,
      newName: next,
      sessionId: currentSessionId,
      source: saved.source,
    }),
    'Rename failed',
  );
  if (result) {
    pushToast('Saved workflow renamed', 'success');
    onChanged();
  }
}

async function deleteSavedWorkflow(
  saved: SavedWorkflowRef,
  currentSessionId: string | null,
  onChanged: () => void,
): Promise<void> {
  if (!currentSessionId) {
    pushToast('Open a session before editing saved workflows', 'warning');
    return;
  }
  if (!window.confirm(`Delete saved workflow "${saved.name}"?`)) return;
  const result = await invokeWorkflowControl(
    window.kodaxSpace?.invoke('workflow.saved.delete', {
      name: saved.name,
      sessionId: currentSessionId,
      source: saved.source,
    }),
    'Delete failed',
  );
  if (result) {
    pushToast('Saved workflow deleted', 'success');
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

function shortRunId(runId: string): string {
  return runId.length > 12 ? `${runId.slice(0, 10)}...` : runId;
}
