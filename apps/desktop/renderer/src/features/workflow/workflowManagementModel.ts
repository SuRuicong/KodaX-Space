import type {
  ChannelOutput,
  WorkflowProcessStatusT,
  WorkflowRunT,
} from '@kodax-space/space-ipc-schema';

export type WorkflowLibrary = ChannelOutput<'workflow.library'>;
export type SavedWorkflowRef = WorkflowLibrary['saved'][number];

export type WorkflowManagementSelection =
  | { readonly kind: 'run'; readonly id: string }
  | { readonly kind: 'saved'; readonly key: string };

const STATUS_RANK: Record<WorkflowProcessStatusT, number> = {
  running: 0,
  paused: 1,
  failed: 2,
  completed: 3,
  cancelled: 4,
};

export function savedWorkflowKey(saved: SavedWorkflowRef): string {
  return `${saved.source ?? 'saved'}:${saved.path}`;
}

export function workflowRunTitle(run: WorkflowRunT): string {
  return run.displayName ?? run.workflowName ?? run.runId;
}

export function workflowRunProjectRoot(run: WorkflowRunT): string | undefined {
  const hostProjectRoot = run.hostMetadata?.projectRoot;
  return run.projectRoot ?? (hostProjectRoot ? hostProjectRoot : undefined);
}

export function workflowRunBelongsToProject(input: {
  readonly run: WorkflowRunT;
  readonly currentProjectPath: string | null;
  readonly currentSessionId: string | null;
  readonly currentSurface: WorkflowRunT['surface'];
  readonly projectSessionIds: ReadonlySet<string>;
}): boolean {
  const { run, currentProjectPath, currentSessionId, currentSurface, projectSessionIds } = input;
  if (run.surface !== undefined && run.surface !== currentSurface) return false;
  if (
    run.sessionId !== undefined &&
    (projectSessionIds.has(run.sessionId) || run.sessionId === currentSessionId)
  ) {
    return true;
  }
  const runProjectRoot = workflowRunProjectRoot(run);
  return (
    runProjectRoot !== undefined &&
    currentProjectPath !== null &&
    normalizeProjectPath(runProjectRoot) === normalizeProjectPath(currentProjectPath)
  );
}

export function sortWorkflowRunsForManagement(
  runs: readonly WorkflowRunT[],
): readonly WorkflowRunT[] {
  return [...runs].sort((a, b) => {
    const status = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (status !== 0) return status;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function chooseWorkflowManagementSelection(input: {
  readonly current: WorkflowManagementSelection | null;
  readonly runs: readonly WorkflowRunT[];
  readonly saved: readonly SavedWorkflowRef[];
  readonly currentSessionId: string | null;
}): WorkflowManagementSelection | null {
  const current = input.current;
  if (current?.kind === 'run' && input.runs.some((run) => run.runId === current.id)) {
    return current;
  }
  if (
    current?.kind === 'saved' &&
    input.saved.some((saved) => savedWorkflowKey(saved) === current.key)
  ) {
    return current;
  }

  const currentSessionActive =
    input.currentSessionId === null
      ? undefined
      : input.runs.find(
          (run) => isActiveWorkflowRun(run) && run.sessionId === input.currentSessionId,
        );
  const active = currentSessionActive ?? input.runs.find(isActiveWorkflowRun);
  const latest = active ?? input.runs[0];
  if (latest) return { kind: 'run', id: latest.runId };
  const firstSaved = input.saved[0];
  return firstSaved ? { kind: 'saved', key: savedWorkflowKey(firstSaved) } : null;
}

export function relatedRunsForSavedWorkflow(
  saved: SavedWorkflowRef,
  runs: readonly WorkflowRunT[],
): readonly WorkflowRunT[] {
  return runs.filter((run) => workflowRunMatchesSaved(saved, run));
}

export function workflowRunMatchesSaved(saved: SavedWorkflowRef, run: WorkflowRunT): boolean {
  const savedNames = new Set([
    normalizeWorkflowName(saved.name),
    normalizeWorkflowName(saved.path),
    normalizeWorkflowName(basename(saved.path)),
  ]);
  const runNames = [
    run.savedWorkflowName,
    run.sourceWorkflowName,
    run.workflowName,
    run.displayName,
  ].map(normalizeWorkflowName);
  return runNames.some((name) => name.length > 0 && savedNames.has(name));
}

function isActiveWorkflowRun(run: WorkflowRunT): boolean {
  return run.status === 'running' || run.status === 'paused';
}

function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

function normalizeWorkflowName(value: string | undefined): string {
  if (!value) return '';
  const base = basename(value).trim().toLowerCase();
  return base
    .replace(/\.workflow\.(mjs|cjs|js|ts|tsx)$/i, '')
    .replace(/\.(mjs|cjs|js|ts|tsx)$/i, '');
}

function normalizeProjectPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return looksLikeWindowsPath(value) ? normalized.toLowerCase() : normalized;
}

function looksLikeWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('//');
}
