import { useCallback, useMemo } from 'react';
import { ExternalLink, Workflow } from 'lucide-react';
import type { WorkflowRunT } from '@kodax-space/space-ipc-schema';
import { useSurfaceStore } from '../../store/surface.js';
import { useAppStore } from '../../store/appStore.js';
import { workflowRunBelongsToProject } from './workflowManagementModel.js';

export function WorkflowNavPanel(): JSX.Element | null {
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workflowRuns = useAppStore((s) => s.workflowRuns);
  const requestPopout = useAppStore((s) => s.requestPopout);
  const activePopoutKind = useAppStore((s) => s.activePopoutKind);
  const currentSurface = useSurfaceStore((s) => s.currentSurface);

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
    return Object.values(workflowRuns).filter((run: WorkflowRunT) =>
      workflowRunBelongsToProject({
        run,
        currentProjectPath,
        currentSessionId,
        currentSurface,
        projectSessionIds,
      }),
    );
  }, [currentProjectPath, currentSessionId, currentSurface, projectSessionIds, workflowRuns]);

  const liveCount = runs.filter(
    (run) => run.status === 'running' || run.status === 'paused',
  ).length;
  const subtitle =
    liveCount > 0 ? `${liveCount} live / ${runs.length} runs` : `${runs.length} runs`;
  const open = activePopoutKind === 'workflow';

  const openWorkflowPanel = useCallback(() => {
    requestPopout('workflow');
  }, [requestPopout]);

  if (!currentProjectPath) return null;

  return (
    <button
      type="button"
      onClick={openWorkflowPanel}
      aria-label="Open workflow panel"
      aria-pressed={open}
      className={`group grid min-h-[44px] w-full grid-cols-[18px_minmax(0,1fr)_18px] items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
        open
          ? 'border-run/55 bg-run/10 text-fg-primary'
          : 'border-border-default/45 bg-surface-2/35 text-fg-secondary hover:border-border-strong hover:bg-hover-bg hover:text-fg-primary'
      }`}
    >
      <Workflow className="h-4 w-4 text-run" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-medium">Workflow</span>
        <span className="block truncate text-[10px] font-mono text-fg-faint">{subtitle}</span>
      </span>
      <ExternalLink
        className="h-3.5 w-3.5 justify-self-end text-fg-faint group-hover:text-fg-muted"
        strokeWidth={1.8}
        aria-hidden
      />
    </button>
  );
}
