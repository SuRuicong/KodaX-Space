// RightSidebar — P2
//
// Cowork / Claude Desktop 风右侧栏，280px 宽，可收起。三块可折叠 section：
//   - Progress: 当前 session todo list 进度可视化（圆点链 + done/total）
//   - Working folder: 当前 projectRoot + 简要 file 树视图
//   - Context: 本 session 已用 tool 列表 + 引用过的文件
//
// 数据源：
//   - todoListBySession (Progress)
//   - currentProjectPath (Working folder header)
//   - eventsBySession[sid] 里的 tool_start / tool_result (Context)
//
// 折叠状态在组件内 useState；外层 open 由 store rightSidebarOpen 控制。

import { useMemo, useState } from 'react';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

const EMPTY_EVENTS: readonly SessionEvent[] = [];

export function RightSidebar(): JSX.Element {
  // open/setOpen 由 Shell 顶层 breadcrumb 行的 SidebarToggleButton 直接管理；
  // open=false 时 Shell 不会渲染本组件（不再保留竖条占位 — 避免无信息密度的 dead zone）
  return (
    <aside className="w-72 border-l border-border-default bg-surface flex flex-col flex-shrink-0 overflow-y-auto">
      <ProgressSection />
      <WorkingFolderSection />
      <ContextSection />
    </aside>
  );
}

// ---- Section 容器（可折叠） ----

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ title, defaultOpen = true, children }: SectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-border-default/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-fg-muted hover:text-fg-primary"
      >
        <span>{title}</span>
        <span aria-hidden className="text-[10px]">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

// ---- Progress（todo list 可视化） ----

function ProgressSection(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const todos = useAppStore((s) =>
    currentSessionId ? s.todoListBySession[currentSessionId] : undefined,
  );

  if (!todos || todos.length === 0) {
    return (
      <Section title="Progress">
        <div className="text-[11px] text-fg-muted leading-relaxed">
          <div className="flex items-center gap-1 mb-2" aria-hidden>
            <CircleEmpty /> <Connector /> <CircleEmpty /> <Connector /> <CircleEmpty />
          </div>
          <div>See task progress for longer tasks.</div>
        </div>
      </Section>
    );
  }

  const done = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const running = todos.find((t) => t.status === 'in_progress');

  return (
    <Section title="Progress">
      {/* 顶部圆点链 — 视觉对齐 Cowork 截图。最多渲染 8 个圆点防溢出 */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        {todos.slice(0, 8).map((t, idx) => (
          <span key={t.id} className="flex items-center gap-1">
            {t.status === 'completed' ? <CircleDone /> : t.status === 'in_progress' ? <CircleActive /> : <CircleEmpty />}
            {idx < Math.min(todos.length, 8) - 1 && <Connector />}
          </span>
        ))}
        {todos.length > 8 && (
          <span className="text-[10px] text-fg-muted ml-1">+{todos.length - 8}</span>
        )}
      </div>
      <div className="text-[11px] text-fg-secondary mb-2">
        {done}/{total} done
        {running?.activeForm && (
          <span className="text-fg-muted"> · {running.activeForm}</span>
        )}
      </div>
      {/* 完整 todo 列表 */}
      <ul className="space-y-1 text-[11px]">
        {todos.map((t) => (
          <li key={t.id} className="flex items-start gap-2">
            <span className="flex-shrink-0 mt-0.5">
              {t.status === 'completed' ? <CircleDone tiny /> : t.status === 'in_progress' ? <CircleActive tiny /> : <CircleEmpty tiny />}
            </span>
            <span
              className={
                t.status === 'completed'
                  ? 'text-fg-muted line-through'
                  : t.status === 'in_progress'
                    ? 'text-fg-primary'
                    : 'text-fg-secondary'
              }
            >
              {t.content}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---- Working folder ----

function WorkingFolderSection(): JSX.Element {
  const projectPath = useAppStore((s) => s.currentProjectPath);
  const projectName = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : null;

  return (
    <Section title="Working folder">
      {projectPath ? (
        <div className="text-[11px] text-fg-secondary space-y-1">
          <div className="flex items-center gap-1.5">
            <span aria-hidden>📁</span>
            <span className="font-medium text-fg-primary truncate" title={projectPath}>
              {projectName}
            </span>
          </div>
          <div className="text-fg-muted text-[10px] font-mono break-all">{projectPath}</div>
        </div>
      ) : (
        <div className="text-[11px] text-fg-muted">No project open.</div>
      )}
    </Section>
  );
}

// ---- Context（用过的工具 + 引用过的文件） ----

function ContextSection(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );

  const refs = useMemo(() => collectContextRefs(events), [events]);

  if (refs.tools.length === 0 && refs.files.length === 0) {
    return (
      <Section title="Context">
        <div className="text-[11px] text-fg-muted leading-relaxed">
          <div className="flex items-center gap-1.5 mb-2 opacity-50" aria-hidden>
            <span className="w-7 h-9 border border-border-default rounded-sm bg-surface-2" />
            <span className="w-7 h-9 border border-border-default rounded-sm bg-surface-2" />
            <span className="w-7 h-9 border border-border-default rounded-sm bg-surface-2" />
          </div>
          Track tools and referenced files used in this task.
        </div>
      </Section>
    );
  }

  return (
    <Section title="Context">
      {refs.tools.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">Tools used</div>
          <div className="flex flex-wrap gap-1">
            {refs.tools.map((t) => (
              <span
                key={t.name}
                className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-fg-secondary"
                title={`${t.count}× ${t.name}`}
              >
                {t.name}
                {t.count > 1 && <span className="text-fg-muted ml-0.5">×{t.count}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      {refs.files.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">Files referenced</div>
          <ul className="space-y-0.5 text-[11px] font-mono">
            {refs.files.slice(0, 20).map((f) => (
              <li key={f} className="truncate text-fg-secondary" title={f}>
                {f}
              </li>
            ))}
            {refs.files.length > 20 && (
              <li className="text-fg-muted">+{refs.files.length - 20} more</li>
            )}
          </ul>
        </div>
      )}
    </Section>
  );
}

interface ContextRefs {
  readonly tools: ReadonlyArray<{ name: string; count: number }>;
  readonly files: readonly string[];
}

function collectContextRefs(events: readonly SessionEvent[]): ContextRefs {
  const toolCounts = new Map<string, number>();
  const files = new Set<string>();
  for (const ev of events) {
    if (ev.kind === 'tool_start') {
      const name = (ev as { toolName?: string }).toolName;
      if (typeof name === 'string') {
        toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
      }
      // 从 input 里抽 path 字段（read/write/edit 等常见 schema）
      const input = (ev as { input?: unknown }).input;
      if (input && typeof input === 'object') {
        const path = (input as { path?: unknown; file_path?: unknown }).path
          ?? (input as { file_path?: unknown }).file_path;
        if (typeof path === 'string' && path.length > 0 && path.length < 512) {
          files.add(path);
        }
      }
    }
  }
  return {
    tools: [...toolCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    files: [...files],
  };
}

// ---- 圆点 + 连接线 svg-free 实现 ----

interface DotProps {
  tiny?: boolean;
}
function CircleDone({ tiny }: DotProps = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3 text-[8px]' : 'w-4 h-4 text-[10px]';
  return (
    <span
      className={`${size} rounded-full bg-emerald-500/80 text-zinc-900 flex items-center justify-center font-bold`}
      aria-hidden
    >
      ✓
    </span>
  );
}
function CircleActive({ tiny }: DotProps = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <span
      className={`${size} rounded-full border-2 border-sky-400 bg-sky-500/30 animate-pulse`}
      aria-hidden
    />
  );
}
function CircleEmpty({ tiny }: DotProps = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return <span className={`${size} rounded-full border border-border-default`} aria-hidden />;
}
function Connector(): JSX.Element {
  return <span className="w-2 h-px bg-border-default" aria-hidden />;
}
