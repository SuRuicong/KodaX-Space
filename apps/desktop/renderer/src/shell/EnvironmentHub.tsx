import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleDot,
  FileText,
  GitBranch,
  GitCommit,
  GitCompare,
  Globe,
  Laptop,
  Plus,
} from 'lucide-react';
import { useAppStore } from '../store/appStore.js';
import { requestTaskDockFocus } from './taskDockControl.js';

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

type HubMenu = 'location' | 'branch' | 'sources' | null;

const EMPTY_GIT_STATUS: GitStatusSnapshot = {
  isGitRepo: false,
  dirty: false,
  modifiedCount: 0,
  stagedCount: 0,
  untrackedCount: 0,
  branch: null,
};

export function EnvironmentHub(): JSX.Element {
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<HubMenu>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusSnapshot>(EMPTY_GIT_STATUS);
  const ref = useRef<HTMLDivElement | null>(null);

  const currentSession = sessions.find((session) => session.sessionId === currentSessionId);
  const projectLabel = useMemo(() => projectName(currentProjectPath), [currentProjectPath]);
  const dirtyCount = gitStatus.modifiedCount + gitStatus.stagedCount + gitStatus.untrackedCount;

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

  const branchLabel = gitStatus.isGitRepo ? (gitStatus.branch ?? 'HEAD') : 'No git';
  const sourceCount = [currentProjectPath, currentSessionId].filter(Boolean).length;

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
        title="Environment information"
        aria-label="Environment information"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="environment-hub-button"
      >
        <CircleDot className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
        <span className="hidden max-w-[140px] truncate sm:inline">{projectLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 text-fg-faint" strokeWidth={1.8} aria-hidden />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-[65] mt-2 w-[min(380px,calc(100vw-28px))] rounded-xl border border-border-default bg-surface-4 p-2 text-[13px] text-fg-secondary shadow-2xl"
          data-testid="environment-hub-popover"
          role="dialog"
          aria-label="Environment information"
          data-surface-kind="anchored_menu"
        >
          <div className="mb-1 flex items-center justify-between px-2 py-1">
            <div>
              <div className="text-[11px] text-fg-faint">Environment</div>
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
              title="Add source"
              aria-label="Add source"
              onClick={() => setMenu((value) => (value === 'sources' ? null : 'sources'))}
            >
              <Plus className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            </button>
          </div>

          <HubRow
            icon={<GitCompare className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            label="Changes"
            value={changesLabel(gitStatus, dirtyCount)}
            tone={dirtyCount > 0 ? 'accent' : 'muted'}
            testId="environment-hub-changes-row"
            onClick={() => focusDock('changes')}
          />
          <HubRow
            icon={<Laptop className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            label="Local"
            value="This device"
            active={menu === 'location'}
            testId="environment-hub-location-row"
            onClick={() => setMenu((value) => (value === 'location' ? null : 'location'))}
          />
          {menu === 'location' && <LocationMenu />}

          <HubRow
            icon={<GitBranch className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            label={branchLabel}
            value={dirtyCount > 0 ? `${dirtyCount} dirty` : 'clean'}
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
            icon={<GitCommit className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            label="Commit or push"
            value={commitLabel(gitStatus, dirtyCount)}
            tone={gitStatus.ahead ? 'accent' : 'muted'}
            testId="environment-hub-commit-row"
            onClick={() => focusDock('changes')}
          />

          <div className="my-2 h-px bg-border-default" />

          <HubRow
            icon={<Globe className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            label="Sources"
            value={`${sourceCount} attached`}
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
  return (
    <div
      className="mb-1 ml-7 rounded-lg border border-border-default bg-surface-3 py-1"
      data-testid="environment-hub-location-menu"
      role="menu"
    >
      <MenuLine checked label="Work locally" detail="Current machine" />
      <MenuLine
        label="Move to worktree"
        detail="Available after worktree handoff support"
        disabled
      />
      <MenuLine label="Send to cloud" detail="Cloud handoff is not configured" disabled />
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
  return (
    <div
      className="mb-1 ml-7 rounded-lg border border-border-default bg-surface-3 py-1"
      data-testid="environment-hub-branch-menu"
      role="menu"
    >
      <MenuLine
        checked={isGitRepo}
        label={branch}
        detail={dirtyCount > 0 ? `${dirtyCount} uncommitted files` : 'Working tree clean'}
      />
      {(ahead || behind) && (
        <MenuLine
          label="Remote status"
          detail={`${ahead ?? 0} ahead / ${behind ?? 0} behind`}
          disabled
        />
      )}
      <MenuLine
        label="Create and check out new branch"
        detail="Coming with branch write actions"
        disabled
      />
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
  return (
    <div
      className="mb-1 ml-7 rounded-lg border border-border-default bg-surface-3 py-1"
      data-testid="environment-hub-sources-menu"
      role="menu"
    >
      <MenuLine
        checked={currentProjectPath !== null}
        label="Workspace folder"
        detail={currentProjectPath ?? 'No project open'}
      />
      <MenuLine
        checked={sessionLabel !== null}
        label="Session context"
        detail={sessionLabel ?? 'No active session'}
      />
      <button
        type="button"
        onClick={onOpenSources}
        className="mt-1 flex w-full items-center gap-2 border-t border-border-default px-2.5 py-1.5 text-left text-[12px] text-fg-secondary hover:bg-hover-bg hover:text-fg-primary"
      >
        <FileText className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.8} aria-hidden />
        <span>Open sources in Task Dock</span>
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
      role="menuitem"
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

function changesLabel(status: GitStatusSnapshot, dirtyCount: number): string {
  if (!status.isGitRepo) return 'not git';
  if (dirtyCount === 0) return 'clean';
  const parts = [
    status.modifiedCount > 0 ? `${status.modifiedCount} mod` : null,
    status.stagedCount > 0 ? `${status.stagedCount} staged` : null,
    status.untrackedCount > 0 ? `${status.untrackedCount} new` : null,
  ].filter(Boolean);
  return parts.join(' / ');
}

function commitLabel(status: GitStatusSnapshot, dirtyCount: number): string {
  if (!status.isGitRepo) return 'disabled';
  if (status.ahead && status.ahead > 0) return `${status.ahead} ahead`;
  if (dirtyCount > 0) return 'ready';
  return 'clean';
}
