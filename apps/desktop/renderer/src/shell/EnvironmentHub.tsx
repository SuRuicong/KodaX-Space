import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleDot,
  FileText,
  GitBranch,
  GitCompare,
  Laptop,
  ListTree,
  PanelRight,
  Plus,
  Upload,
} from 'lucide-react';
import { useAppStore } from '../store/appStore.js';
import { requestTaskDockFocus } from './taskDockControl.js';
import { useI18n } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';

interface GitStatusSnapshot {
  readonly isGitRepo: boolean;
  readonly dirty: boolean;
  readonly modifiedCount: number;
  readonly stagedCount: number;
  readonly untrackedCount: number;
  readonly branch: string | null;
  readonly ahead?: number;
  readonly behind?: number;
}

type HubMenu = 'location' | 'branch' | 'commit' | 'sources' | null;

const EMPTY_GIT_STATUS: GitStatusSnapshot = {
  isGitRepo: false,
  dirty: false,
  modifiedCount: 0,
  stagedCount: 0,
  untrackedCount: 0,
  branch: null,
};

export function EnvironmentHub(): JSX.Element {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<HubMenu>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusSnapshot>(EMPTY_GIT_STATUS);
  const ref = useRef<HTMLDivElement | null>(null);

  const currentSession = sessions.find((session) => session.sessionId === currentSessionId);
  const projectLabel = useMemo(
    () => (currentProjectPath ? projectName(currentProjectPath) : t('environment.noProject')),
    [currentProjectPath, t],
  );
  const dirtyCount = gitStatus.modifiedCount + gitStatus.stagedCount + gitStatus.untrackedCount;
  const hasSessionContext = currentSession !== undefined || currentSessionId !== null;

  const refreshGitStatus = useCallback((): void => {
    if (!currentProjectPath || !window.kodaxSpace) {
      setGitStatus(EMPTY_GIT_STATUS);
      return;
    }
    void window.kodaxSpace
      .invoke('project.gitStatus', { projectRoot: currentProjectPath })
      .then((result) => {
        if (!result.ok) return;
        if (useAppStore.getState().currentProjectPath !== currentProjectPath) return;
        setGitStatus({
          isGitRepo: result.data.isGitRepo,
          dirty: result.data.dirty,
          modifiedCount: result.data.modifiedCount,
          stagedCount: result.data.stagedCount,
          untrackedCount: result.data.untrackedCount,
          branch: result.data.branch,
          ...(result.data.ahead !== undefined ? { ahead: result.data.ahead } : {}),
          ...(result.data.behind !== undefined ? { behind: result.data.behind } : {}),
        });
      });
  }, [currentProjectPath]);

  useEffect(() => {
    refreshGitStatus();
  }, [refreshGitStatus]);

  useEffect(() => {
    if (!currentProjectPath) return;
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') refreshGitStatus();
    };
    window.addEventListener('focus', refreshGitStatus);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = setInterval(refreshGitStatus, 30_000);
    return () => {
      window.removeEventListener('focus', refreshGitStatus);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, [currentProjectPath, refreshGitStatus]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setMenu(null);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        setMenu(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const focusDock = (section: Parameters<typeof requestTaskDockFocus>[0]): void => {
    requestTaskDockFocus(section);
    setOpen(false);
    setMenu(null);
  };

  const branchLabel = gitStatus.isGitRepo ? (gitStatus.branch ?? 'HEAD') : t('environment.noGit');

  return (
    <div ref={ref} className="relative flex-shrink-0" data-testid="environment-hub-root">
      <button
        type="button"
        onClick={() => {
          refreshGitStatus();
          setOpen((value) => !value);
        }}
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors ${
          open
            ? 'border-border-strong bg-surface-3 text-fg-primary'
            : 'border-border-default bg-surface-2 text-fg-secondary hover:bg-hover-bg hover:text-fg-primary'
        }`}
        title={t('environment.info')}
        aria-label={t('environment.info')}
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="environment-hub-button"
      >
        <CircleDot className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
        <span className="hidden max-w-[140px] truncate sm:inline">{projectLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 text-fg-faint" strokeWidth={1.8} aria-hidden />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-[65] mt-2 max-h-[min(560px,calc(100vh-84px))] w-[min(380px,calc(100vw-28px))] overflow-y-auto overscroll-contain rounded-xl border border-border-default bg-surface-4 p-2 text-[13px] text-fg-secondary shadow-2xl"
          data-testid="environment-hub-popover"
          role="group"
          aria-label={t('environment.info')}
          data-surface-kind="anchored_menu"
        >
          <div className="mb-1 flex items-center justify-between px-2 py-1">
            <div>
              <div className="text-[11px] text-fg-faint">{t('environment.title')}</div>
              <div
                className="max-w-[260px] truncate font-medium text-fg-primary"
                title={currentProjectPath ?? undefined}
              >
                {projectLabel}
              </div>
            </div>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
              title={t('environment.addSource')}
              aria-label={t('environment.addSource')}
              onClick={() => setMenu((value) => (value === 'sources' ? null : 'sources'))}
            >
              <Plus className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            </button>
          </div>
          <HubRow
            icon={<GitCompare className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            label={t('environment.changes')}
            value={changesLabel(gitStatus, dirtyCount, t)}
            tone={dirtyCount > 0 ? 'accent' : 'muted'}
            testId="environment-hub-changes-row"
            onClick={() => focusDock('changes')}
          />
          <HubRow
            icon={<Laptop className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            label={t('environment.local')}
            value={t('environment.thisDevice')}
            active={menu === 'location'}
            testId="environment-hub-location-row"
            onClick={() => setMenu((value) => (value === 'location' ? null : 'location'))}
          />
          {menu === 'location' && <LocationMenu />}

          <HubRow
            icon={<GitBranch className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            label={branchLabel}
            value={
              dirtyCount > 0
                ? t('environment.dirtyCount', { count: dirtyCount })
                : t('environment.clean')
            }
            active={menu === 'branch'}
            testId="environment-hub-branch-row"
            onClick={() => setMenu((value) => (value === 'branch' ? null : 'branch'))}
          />
          {menu === 'branch' && (
            <BranchMenu
              branch={branchLabel}
              dirtyCount={dirtyCount}
              ahead={gitStatus.ahead}
              behind={gitStatus.behind}
              isGitRepo={gitStatus.isGitRepo}
            />
          )}

          <HubRow
            icon={<Upload className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            label={t('environment.commitPush')}
            value={commitPushLabel(gitStatus, dirtyCount, t)}
            tone={commitPushTone(gitStatus, dirtyCount)}
            active={menu === 'commit'}
            testId="environment-hub-commit-row"
            onClick={() => setMenu((value) => (value === 'commit' ? null : 'commit'))}
          />
          {menu === 'commit' && (
            <CommitPushMenu
              gitStatus={gitStatus}
              dirtyCount={dirtyCount}
              onOpenChanges={() => focusDock('changes')}
            />
          )}

          <HubRow
            icon={<FileText className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            label={t('environment.sources')}
            value={sourcesLabel(currentProjectPath !== null, hasSessionContext, t)}
            active={menu === 'sources'}
            testId="environment-hub-sources-row"
            onClick={() => setMenu((value) => (value === 'sources' ? null : 'sources'))}
          />
          {menu === 'sources' && (
            <SourcesMenu
              currentProjectPath={currentProjectPath}
              sessionLabel={currentSession?.title ?? currentSessionId ?? null}
              onOpenSources={() => focusDock('sources')}
            />
          )}

          <HubRow
            icon={<PanelRight className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            label={t('environment.taskDock')}
            value={t('environment.rightSidebar')}
            testId="environment-hub-task-dock-row"
            onClick={() => focusDock('run')}
          />

          <div className="my-2 h-px bg-border-default" />

          <HubRow
            icon={<ListTree className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            label={t('environment.context')}
            value={t('environment.toolsAndFiles')}
            testId="environment-hub-context-row"
            onClick={() => focusDock('context')}
          />
        </div>
      )}
    </div>
  );
}

interface HubRowProps {
  readonly icon: JSX.Element;
  readonly label: string;
  readonly value: string;
  readonly active?: boolean;
  readonly tone?: 'muted' | 'accent';
  readonly testId: string;
  readonly onClick: () => void;
}

function HubRow({
  icon,
  label,
  value,
  active = false,
  tone = 'muted',
  testId,
  onClick,
}: HubRowProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover-bg ${
        active ? 'bg-surface-3 text-fg-primary' : 'text-fg-secondary'
      }`}
      data-testid={testId}
    >
      <span className="flex h-5 w-5 items-center justify-center text-fg-muted">{icon}</span>
      <span className="truncate">{label}</span>
      <span
        className={`text-[12px] tabular-nums ${
          tone === 'accent' ? 'text-accent-ink' : 'text-fg-muted'
        }`}
      >
        {value}
      </span>
    </button>
  );
}

function LocationMenu(): JSX.Element {
  const { t } = useI18n();
  return (
    <div
      className="mb-1 ml-7 rounded-lg border border-border-default bg-surface-3 py-1"
      data-testid="environment-hub-location-menu"
    >
      <MenuLine
        checked
        label={t('environment.workLocally')}
        detail={t('environment.currentMachine')}
      />
      <MenuLine
        label={t('environment.moveToWorktree')}
        detail={t('environment.worktreeHandoffUnavailable')}
        disabled
      />
      <MenuLine
        label={t('environment.sendToCloud')}
        detail={t('environment.cloudHandoffNotConfigured')}
        disabled
      />
    </div>
  );
}

function BranchMenu({
  branch,
  dirtyCount,
  ahead,
  behind,
  isGitRepo,
}: {
  readonly branch: string;
  readonly dirtyCount: number;
  readonly ahead?: number;
  readonly behind?: number;
  readonly isGitRepo: boolean;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div
      className="mb-1 ml-7 rounded-lg border border-border-default bg-surface-3 py-1"
      data-testid="environment-hub-branch-menu"
    >
      <MenuLine
        checked={isGitRepo}
        label={branch}
        detail={
          dirtyCount > 0
            ? t('environment.uncommittedFiles', { count: dirtyCount })
            : t('environment.workingTreeClean')
        }
      />
      {(ahead || behind) && (
        <MenuLine
          label={t('environment.remoteStatus')}
          detail={t('environment.aheadBehind', { ahead: ahead ?? 0, behind: behind ?? 0 })}
          disabled
        />
      )}
      <MenuLine
        label={t('environment.createBranch')}
        detail={t('environment.branchActionsComing')}
        disabled
      />
    </div>
  );
}

function CommitPushMenu({
  gitStatus,
  dirtyCount,
  onOpenChanges,
}: {
  readonly gitStatus: GitStatusSnapshot;
  readonly dirtyCount: number;
  readonly onOpenChanges: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const hasRemoteState = (gitStatus.ahead ?? 0) > 0 || (gitStatus.behind ?? 0) > 0;
  return (
    <div
      className="mb-1 ml-7 rounded-lg border border-border-default bg-surface-3 py-1"
      data-testid="environment-hub-commit-menu"
    >
      <MenuLine
        checked={gitStatus.isGitRepo && (dirtyCount > 0 || hasRemoteState)}
        label={t('environment.commitPushStatus')}
        detail={commitPushLabel(gitStatus, dirtyCount, t)}
      />
      <MenuLine
        label={t('environment.commitPush')}
        detail={t('environment.commitPushActionsComing')}
        disabled
      />
      <button
        type="button"
        onClick={onOpenChanges}
        className="mt-1 flex w-full items-center gap-2 border-t border-border-default px-2.5 py-1.5 text-left text-[12px] text-fg-secondary hover:bg-hover-bg hover:text-fg-primary"
      >
        <GitCompare className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.8} aria-hidden />
        <span>{t('environment.openChangesTaskDock')}</span>
      </button>
    </div>
  );
}

function SourcesMenu({
  currentProjectPath,
  sessionLabel,
  onOpenSources,
}: {
  readonly currentProjectPath: string | null;
  readonly sessionLabel: string | null;
  readonly onOpenSources: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div
      className="mb-1 ml-7 rounded-lg border border-border-default bg-surface-3 py-1"
      data-testid="environment-hub-sources-menu"
    >
      <MenuLine
        checked={currentProjectPath !== null}
        label={t('environment.workspaceFolder')}
        detail={currentProjectPath ?? t('environment.noProjectOpen')}
      />
      <MenuLine
        checked={sessionLabel !== null}
        label={t('environment.sessionContext')}
        detail={sessionLabel ?? t('environment.noActiveSession')}
      />
      <button
        type="button"
        onClick={onOpenSources}
        className="mt-1 flex w-full items-center gap-2 border-t border-border-default px-2.5 py-1.5 text-left text-[12px] text-fg-secondary hover:bg-hover-bg hover:text-fg-primary"
      >
        <FileText className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.8} aria-hidden />
        <span>{t('environment.openSourcesTaskDock')}</span>
      </button>
    </div>
  );
}

function MenuLine({
  label,
  detail,
  checked = false,
  disabled = false,
}: {
  readonly label: string;
  readonly detail: string;
  readonly checked?: boolean;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <div
      className={`grid grid-cols-[18px_minmax(0,1fr)] gap-2 px-2.5 py-1.5 ${
        disabled ? 'text-fg-faint' : 'text-fg-secondary'
      }`}
      aria-disabled={disabled}
    >
      <span className="flex h-4 w-4 items-center justify-center">
        {checked && <Check className="h-3.5 w-3.5 text-accent-ink" strokeWidth={2.2} aria-hidden />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12px]">{label}</span>
        <span className="block truncate text-[11px] text-fg-faint" title={detail}>
          {detail}
        </span>
      </span>
    </div>
  );
}

function projectName(path: string | null): string {
  if (!path) return 'No project';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function changesLabel(status: GitStatusSnapshot, dirtyCount: number, t: Translate): string {
  if (!status.isGitRepo) return t('environment.changes.notGit');
  if (dirtyCount === 0) return t('environment.clean');
  const parts = [
    status.modifiedCount > 0 ? t('environment.changes.mod', { count: status.modifiedCount }) : null,
    status.stagedCount > 0 ? t('environment.changes.staged', { count: status.stagedCount }) : null,
    status.untrackedCount > 0
      ? t('environment.changes.new', { count: status.untrackedCount })
      : null,
  ].filter(Boolean);
  return parts.join(' / ');
}

function commitPushLabel(status: GitStatusSnapshot, dirtyCount: number, t: Translate): string {
  if (!status.isGitRepo) return t('environment.noGit');
  if (dirtyCount > 0) return t('environment.uncommittedFiles', { count: dirtyCount });
  if ((status.ahead ?? 0) > 0 || (status.behind ?? 0) > 0) {
    return t('environment.aheadBehind', {
      ahead: status.ahead ?? 0,
      behind: status.behind ?? 0,
    });
  }
  return t('environment.workingTreeClean');
}

function commitPushTone(status: GitStatusSnapshot, dirtyCount: number): 'accent' | 'muted' {
  if (!status.isGitRepo) return 'muted';
  return dirtyCount > 0 || (status.ahead ?? 0) > 0 || (status.behind ?? 0) > 0
    ? 'accent'
    : 'muted';
}

function sourcesLabel(hasWorkspace: boolean, hasSession: boolean, t: Translate): string {
  if (hasWorkspace && hasSession) return t('environment.sources.workspaceSession');
  if (hasWorkspace) return t('environment.sources.workspace');
  if (hasSession) return t('environment.sources.session');
  return t('environment.sources.none');
}
