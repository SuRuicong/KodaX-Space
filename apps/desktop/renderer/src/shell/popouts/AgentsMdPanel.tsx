// AgentsMdPanel — FEATURE_034
//
// 显示当前 session 已加载的 AGENTS.md 文件（global + project，scope 颜色区分）。
// 数据通过 session.agentsMd invoke 拉，每次打开 popout 都重新拉一次——满足
// "AGENTS.md 修改后下次打开即生效"的 KodaX REPL 行为。
//
// 多文件 → 顶部 tab 切换；单文件 → 直接展开。
// 文件较大（256KB 上限）但仍直接 textarea 渲染——alpha.1 阶段不引入 markdown 渲染器，
// 让用户看到 raw 内容能直接对照磁盘。

import { useEffect, useState } from 'react';
import type { AgentsFileMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';

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

export function AgentsMdPanel(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [files, setFiles] = useState<readonly AgentsFileMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // 每次 session 切换或 popout 打开都重拉
  useEffect(() => {
    if (!currentSessionId || !window.kodaxSpace) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.kodaxSpace
      .invoke('session.agentsMd', { sessionId: currentSessionId })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setError(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'unknown error'}`);
          setFiles([]);
          return;
        }
        setFiles(r.data.files);
        setActiveIdx(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentSessionId]);

  if (!currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-xs">
        No active session.
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
      </div>
    );
  }

  const active = files[activeIdx] ?? files[0];

  return (
    <div className="h-full flex flex-col text-xs">
      <header className="px-3 py-2 border-b border-zinc-800/60 flex items-center justify-between">
        <div className="text-zinc-300 font-medium">
          AGENTS.md{' '}
          <span className="text-zinc-500 font-normal">
            ({files.length} loaded)
          </span>
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
