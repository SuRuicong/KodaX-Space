// AgentsMdPanel — FEATURE_034 + FEATURE_197
//
// 一个 popout 容纳两类 agent 配置：
//   - Context tab: AGENTS.md 文件（global + project，对话被注入的隐式 system 上下文）
//   - Custom tab : ~/.kodax/agents/*.md 和 <project>/.kodax/agents/*.md 用户自定义 agents
//     （KodaX v0.7.43 FEATURE_191 加载、FEATURE_197 暴露 discovery）
//
// 数据每次 popout 打开或 session/项目切换都重拉，与磁盘保持同步。

import { useEffect, useState } from 'react';
import type { AgentsFileMeta, AgentMeta, AgentFailure } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';

type Tab = 'context' | 'custom';

const SCOPE_LABELS: Record<AgentsFileMeta['scope'], string> = {
  global: '~/.kodax',
  project: 'Project',
  directory: 'Dir',
};

const SCOPE_COLORS: Record<AgentsFileMeta['scope'], string> = {
  global: 'text-amber-400',
  project: 'text-emerald-400',
  directory: 'text-sky-400',
};

const AGENT_SOURCE_LABELS: Record<AgentMeta['source'], string> = {
  'markdown:user': '~/.kodax',
  'markdown:project': 'Project',
};

const AGENT_SOURCE_COLORS: Record<AgentMeta['source'], string> = {
  'markdown:user': 'text-amber-400',
  'markdown:project': 'text-emerald-400',
};

export function AgentsMdPanel(): JSX.Element {
  const [tab, setTab] = useState<Tab>('context');
  return (
    <div className="h-full flex flex-col text-xs">
      <div className="px-2 py-1 border-b border-zinc-900 flex gap-1 flex-shrink-0">
        <TabButton active={tab === 'context'} onClick={() => setTab('context')} label="Context" />
        <TabButton active={tab === 'custom'} onClick={() => setTab('custom')} label="Custom" />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'context' ? <ContextTab /> : <CustomAgentsTab />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded text-[11px] font-medium ${
        active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
      }`}
    >
      {label}
    </button>
  );
}

// ---- Context tab — 既有 AGENTS.md 展示 ----

function ContextTab(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [files, setFiles] = useState<readonly AgentsFileMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  // 编辑态: editing!=null 时显示 textarea。draft 是 textarea 当前值; saving = IPC 飞行
  const [editing, setEditing] = useState<{ scope: 'global' | 'project'; sourcePath?: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reload = (): void => {
    if (!currentSessionId || !window.kodaxSpace) {
      setFiles([]);
      return;
    }
    setLoading(true);
    setError(null);
    void window.kodaxSpace
      .invoke('session.agentsMd', { sessionId: currentSessionId })
      .then((r) => {
        if (!r.ok) {
          setError(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'unknown error'}`);
          setFiles([]);
          return;
        }
        setFiles(r.data.files);
        setActiveIdx(0);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  function startEdit(scope: 'global' | 'project', initialContent: string, sourcePath?: string): void {
    setDraft(initialContent);
    setEditing({ scope, sourcePath });
    setSaveError(null);
  }
  function cancelEdit(): void {
    setEditing(null);
    setDraft('');
    setSaveError(null);
  }
  async function commitEdit(): Promise<void> {
    if (!editing || !currentSessionId || !window.kodaxSpace) return;
    if (draft.length > 262_144) {
      setSaveError('Content exceeds 256KB limit');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await window.kodaxSpace.invoke('session.agentsMd.save', {
        sessionId: currentSessionId,
        scope: editing.scope,
        content: draft,
      });
      if (!r.ok) {
        setSaveError(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'save failed'}`);
        return;
      }
      // 成功 → 退编辑 + 重读磁盘 (新文件路径出现在 files 列表里)
      cancelEdit();
      reload();
    } finally {
      setSaving(false);
    }
  }

  if (!currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-xs">
        No active session.
      </div>
    );
  }

  // 编辑模式: textarea + Save / Cancel (REPL /memory inline 等价)
  if (editing !== null) {
    return (
      <div className="h-full flex flex-col text-xs">
        <header className="px-3 py-2 border-b border-zinc-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={SCOPE_COLORS[editing.scope]}>●</span>
            <span className="text-zinc-300 font-medium">
              Editing {SCOPE_LABELS[editing.scope]} AGENTS.md
            </span>
            {editing.sourcePath && (
              <span className="text-[10px] text-zinc-500 font-mono truncate" title={editing.sourcePath}>
                {editing.sourcePath}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="px-2 py-0.5 text-[10px] rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void commitEdit()}
              disabled={saving}
              className="px-2 py-0.5 text-[10px] rounded bg-emerald-600/40 text-emerald-200 hover:bg-emerald-600/60 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </header>
        {saveError !== null && (
          <div className="px-3 py-1 text-[11px] text-red-400 font-mono border-b border-zinc-900">
            {saveError}
          </div>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={saving}
          spellCheck={false}
          autoFocus
          className="flex-1 min-h-0 bg-zinc-950 text-zinc-200 text-[12px] font-mono px-3 py-2 focus:outline-none resize-none leading-relaxed disabled:opacity-50"
          placeholder={`# AGENTS.md (${editing.scope})\n\nWrite KodaX context here…`}
        />
        <div className="px-3 py-1 text-[10px] text-zinc-500 border-t border-zinc-900 flex justify-between">
          <span>{draft.length.toLocaleString()} / 256k chars</span>
          <span>{editing.scope === 'global' ? '~/.kodax/AGENTS.md' : '<project>/AGENTS.md'}</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-xs">
        Loading AGENTS.md…
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="h-full p-4 text-xs text-red-400 font-mono">
        Failed: {error}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-xs p-4 gap-2">
        <span aria-hidden className="text-2xl">⌬</span>
        <div className="text-zinc-500">No AGENTS.md loaded</div>
        <div className="text-center max-w-[300px]">
          Add{' '}
          <code className="text-zinc-400 bg-zinc-900 px-1 rounded">~/.kodax/AGENTS.md</code> for
          global context, or{' '}
          <code className="text-zinc-400 bg-zinc-900 px-1 rounded">{'<project>/AGENTS.md'}</code>{' '}
          for project context. KodaX will load them on the next send.
        </div>
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => startEdit('global', '# AGENTS.md (global)\n\n')}
            className="px-2.5 py-1 text-[11px] rounded bg-amber-600/30 text-amber-200 hover:bg-amber-600/50"
          >
            Create global
          </button>
          <button
            type="button"
            onClick={() => startEdit('project', '# AGENTS.md (project)\n\n')}
            className="px-2.5 py-1 text-[11px] rounded bg-emerald-600/30 text-emerald-200 hover:bg-emerald-600/50"
          >
            Create project
          </button>
        </div>
      </div>
    );
  }

  const active = files[activeIdx] ?? files[0];
  // 编辑按钮: 只有 global/project scope 可编辑 (directory 不开放写,见 main handler)
  const editableScope: 'global' | 'project' | null = active.scope === 'global' || active.scope === 'project'
    ? active.scope
    : null;

  return (
    <div className="h-full flex flex-col text-xs">
      <header className="px-3 py-2 border-b border-zinc-800/60 flex items-center justify-between">
        <div className="text-zinc-300 font-medium">
          AGENTS.md{' '}
          <span className="text-zinc-500 font-normal">
            ({files.length} loaded)
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {editableScope !== null && (
            <button
              type="button"
              onClick={() => startEdit(editableScope, active.content, active.path)}
              className="px-2 py-0.5 text-[10px] rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              title={`Edit ${SCOPE_LABELS[editableScope]} AGENTS.md`}
            >
              ✎ Edit
            </button>
          )}
          {/* Create the OTHER scope if it's not in the loaded list */}
          {!files.some((f) => f.scope === 'global') && (
            <button
              type="button"
              onClick={() => startEdit('global', '# AGENTS.md (global)\n\n')}
              className="px-2 py-0.5 text-[10px] rounded text-amber-400 hover:text-amber-200 hover:bg-amber-900/30"
              title="Create global AGENTS.md (~/.kodax/AGENTS.md)"
            >
              + Global
            </button>
          )}
          {!files.some((f) => f.scope === 'project') && (
            <button
              type="button"
              onClick={() => startEdit('project', '# AGENTS.md (project)\n\n')}
              className="px-2 py-0.5 text-[10px] rounded text-emerald-400 hover:text-emerald-200 hover:bg-emerald-900/30"
              title="Create project AGENTS.md"
            >
              + Project
            </button>
          )}
        </div>
      </header>

      {files.length > 1 && (
        <div className="px-2 py-1 border-b border-zinc-900 flex gap-1 flex-wrap">
          {files.map((f, idx) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                idx === activeIdx
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              }`}
              title={f.path}
            >
              <span className={SCOPE_COLORS[f.scope]}>●</span>{' '}
              <span>{SCOPE_LABELS[f.scope]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="px-3 py-1.5 text-[10px] text-zinc-500 font-mono truncate" title={active.path}>
        <span className={SCOPE_COLORS[active.scope]}>{SCOPE_LABELS[active.scope]}</span>{' '}
        {active.path}
      </div>

      <pre className="flex-1 overflow-auto px-3 pb-3 text-[11px] text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">
        {active.content}
      </pre>
    </div>
  );
}

// ---- Custom tab — F197 markdown agents ----

function CustomAgentsTab(): JSX.Element {
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const [agents, setAgents] = useState<readonly AgentMeta[]>([]);
  const [failed, setFailed] = useState<readonly AgentFailure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (!projectRoot || !window.kodaxSpace) {
      setAgents([]);
      setFailed([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.kodaxSpace
      .invoke('agent.discover', { projectRoot })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setError(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'unknown error'}`);
          setAgents([]);
          setFailed([]);
          return;
        }
        setAgents(r.data.agents);
        setFailed(r.data.failed);
        setActiveIdx(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  if (!projectRoot) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-xs p-4 text-center">
        Open a project to scan for custom agents.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-xs">
        Loading agents…
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="h-full p-4 text-xs text-red-400 font-mono">
        Failed: {error}
      </div>
    );
  }

  if (agents.length === 0 && failed.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-xs p-4 gap-2">
        <span aria-hidden className="text-2xl">✦</span>
        <div className="text-zinc-500">No custom agents</div>
        <div className="text-center max-w-[320px]">
          Drop a markdown file into{' '}
          <code className="text-zinc-400 bg-zinc-900 px-1 rounded">~/.kodax/agents/</code> for
          user-level, or{' '}
          <code className="text-zinc-400 bg-zinc-900 px-1 rounded">
            {'<project>/.kodax/agents/'}
          </code>{' '}
          for project-level. KodaX will register them on the next session start.
        </div>
      </div>
    );
  }

  const active = agents[activeIdx];

  return (
    <div className="h-full flex flex-col text-xs">
      <header className="px-3 py-2 border-b border-zinc-800/60 flex items-center justify-between">
        <div className="text-zinc-300 font-medium">
          Custom agents{' '}
          <span className="text-zinc-500 font-normal">({agents.length})</span>
        </div>
      </header>

      {failed.length > 0 && (
        <div
          className="px-3 py-1.5 text-[10px] text-amber-400 bg-amber-950/30 border-b border-amber-900/40 flex-shrink-0"
          role="status"
          aria-label="agent load failures"
        >
          {failed.length} file{failed.length === 1 ? '' : 's'} failed to load.{' '}
          <span className="text-amber-500" title={failed.map((f) => `${f.path}: ${f.reason}`).join('\n')}>
            Hover for details
          </span>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Left: agent list */}
        <ul
          className="w-[180px] border-r border-zinc-900 overflow-auto flex-shrink-0"
          role="listbox"
          aria-label="custom agents"
        >
          {agents.map((a, idx) => (
            <li key={a.path}>
              <button
                type="button"
                onClick={() => setActiveIdx(idx)}
                className={`w-full text-left px-2.5 py-1.5 flex flex-col gap-0.5 ${
                  idx === activeIdx
                    ? 'bg-zinc-800/80 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
                title={a.path}
                role="option"
                aria-selected={idx === activeIdx}
              >
                <span className="font-mono text-[11px] truncate">
                  <span className={AGENT_SOURCE_COLORS[a.source]}>●</span> {a.name}
                </span>
                <span className="text-[10px] text-zinc-500 truncate">
                  {AGENT_SOURCE_LABELS[a.source]}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/* Right: detail */}
        <div className="flex-1 min-w-0 overflow-auto px-3 py-2">
          {active ? (
            <div className="flex flex-col gap-2">
              <div>
                <div className="text-[11px] text-zinc-100 font-mono">{active.name}</div>
                <div className="text-[10px] text-zinc-500 font-mono truncate" title={active.path}>
                  <span className={AGENT_SOURCE_COLORS[active.source]}>
                    {AGENT_SOURCE_LABELS[active.source]}
                  </span>{' '}
                  {active.path}
                </div>
              </div>
              <div className="text-[11px] text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {active.description}
              </div>
              {active.tools && active.tools.length > 0 && (
                <div className="text-[10px] text-zinc-500">
                  <span className="text-zinc-400">Tools: </span>
                  <span className="font-mono">{active.tools.join(', ')}</span>
                </div>
              )}
              {active.model !== undefined && (
                <div className="text-[10px] text-zinc-500">
                  <span className="text-zinc-400">Model: </span>
                  <span className="font-mono">{active.model}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-zinc-600 text-[11px] py-4">Select an agent.</div>
          )}
        </div>
      </div>
    </div>
  );
}
