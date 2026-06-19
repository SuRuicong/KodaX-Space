// F063 — Workflow 启动器：浏览 built-in + saved 工作流，预检（saved）后从当前 session 发起。
//
// 挂在 workflow popout 顶部（WorkflowPanelConnected）。无 run 时也能从这里发起第一个工作流
// （解决"无 run→无 Section→无入口"的鸡蛋问题：workflow popout 在 CommandToolbar 常驻可达）。

import { useState } from 'react';
import { Play, ChevronDown, ChevronRight, ShieldCheck, RefreshCw, Lock } from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';
import { pushToast } from '../../store/toastStore.js';

interface MetaLite {
  name: string;
  description: string;
  plannedAgents?: number;
  readOnly?: boolean;
}
interface SavedLite {
  name: string;
  path: string;
  description?: string;
}

export function WorkflowLauncher(): JSX.Element {
  const sessionId = useAppStore((s) => s.currentSessionId);
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [builtin, setBuiltin] = useState<MetaLite[]>([]);
  const [saved, setSaved] = useState<SavedLite[]>([]);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);

  async function loadLibrary(): Promise<void> {
    setLoading(true);
    try {
      const r = await window.kodaxSpace?.invoke('workflow.library', projectRoot ? { projectRoot } : {});
      if (r?.ok) {
        setBuiltin(r.data.builtin);
        setSaved(r.data.saved);
      } else {
        pushToast('加载工作流库失败', 'warning');
      }
    } catch {
      pushToast('加载工作流库失败', 'warning');
    } finally {
      setLoading(false);
    }
  }

  function toggle(): void {
    const next = !expanded;
    setExpanded(next);
    if (next && builtin.length === 0 && saved.length === 0) void loadLibrary();
  }

  async function launch(target: string, source: 'builtin' | 'saved', savedPath?: string): Promise<void> {
    if (!sessionId) {
      pushToast('请先选择或创建一个会话再启动工作流', 'warning');
      return;
    }
    setBusyTarget(target);
    try {
      // saved 先预检；有问题则确认后再启动（built-in 视为可信，跳过）。
      if (source === 'saved' && savedPath) {
        const pf = await window.kodaxSpace?.invoke('workflow.preflight', { path: savedPath, sessionId });
        if (!pf?.ok) {
          pushToast(pf?.error?.message ? `预检失败：${pf.error.message}` : '预检失败', 'warning');
          return;
        }
        if (!pf.data.ok && pf.data.issues.length > 0) {
          const msg = pf.data.issues.map((i) => `• ${i.message}`).join('\n');
          if (!window.confirm(`预检发现问题：\n${msg}\n\n仍然启动？`)) return;
        }
      }
      const r = await window.kodaxSpace?.invoke('workflow.start', { target, source, sessionId });
      if (!r?.ok || !r.data.runId) {
        pushToast(r?.ok ? (r.data.error ?? '启动失败') : (r?.error?.message ?? '启动失败'), 'warning');
        return;
      }
      pushToast(`工作流已启动：${target} (${r.data.runId})`, 'success');
      setExpanded(false);
    } catch (err) {
      pushToast(err instanceof Error ? `启动失败：${err.message}` : '启动失败', 'warning');
    } finally {
      setBusyTarget(null);
    }
  }

  return (
    <div className="mb-2 rounded-lg border border-border-default/70 bg-surface-2">
      <div className="flex items-center pr-1">
        <button
          type="button"
          onClick={toggle}
          className="flex-1 flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-medium text-fg-secondary hover:text-fg-primary"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Play size={12} className="text-accent" />
          启动工作流
        </button>
        {expanded && (
          <button
            type="button"
            onClick={() => void loadLibrary()}
            title="刷新列表"
            aria-label="刷新工作流列表"
            className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          {loading && builtin.length === 0 && saved.length === 0 ? (
            <div className="text-[11px] text-fg-muted py-1">加载中…</div>
          ) : (
            <>
              <LibGroup title="内置">
                {builtin.length === 0 ? (
                  <EmptyHint text="无内置工作流" />
                ) : (
                  builtin.map((w) => (
                    <LibItem
                      key={w.name}
                      name={w.name}
                      description={w.description}
                      readOnly={w.readOnly}
                      plannedAgents={w.plannedAgents}
                      busy={busyTarget === w.name}
                      onLaunch={() => void launch(w.name, 'builtin')}
                    />
                  ))
                )}
              </LibGroup>
              <LibGroup title="已保存">
                {saved.length === 0 ? (
                  <EmptyHint text="无已保存工作流（~/.kodax/workflows）" />
                ) : (
                  saved.map((w) => (
                    <LibItem
                      key={w.path}
                      name={w.name}
                      description={w.description ?? ''}
                      busy={busyTarget === w.path}
                      preflightable
                      onLaunch={() => void launch(w.path, 'saved', w.path)}
                    />
                  ))
                )}
              </LibGroup>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LibGroup({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wide text-fg-faint px-1 pb-0.5">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }): JSX.Element {
  return <div className="text-[11px] text-fg-muted px-1 py-0.5">{text}</div>;
}

function LibItem({
  name,
  description,
  readOnly,
  plannedAgents,
  preflightable,
  busy,
  onLaunch,
}: {
  name: string;
  description: string;
  readOnly?: boolean;
  plannedAgents?: number;
  preflightable?: boolean;
  busy?: boolean;
  onLaunch: () => void;
}): JSX.Element {
  return (
    <div className="flex items-start gap-1.5 rounded border border-border-default/60 bg-surface p-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-fg-primary truncate" title={name}>
            {name}
          </span>
          {readOnly && (
            <span className="inline-flex items-center gap-0.5 text-[9px] text-ok" title="只读（不写文件）">
              <Lock size={9} /> 只读
            </span>
          )}
          {plannedAgents !== undefined && (
            <span className="text-[9px] font-mono text-fg-faint">~{plannedAgents} agents</span>
          )}
          {preflightable && <ShieldCheck size={10} className="text-fg-faint" aria-label="启动前预检" />}
        </div>
        {description && <div className="text-[10px] text-fg-muted line-clamp-2">{description}</div>}
      </div>
      <button
        type="button"
        onClick={onLaunch}
        disabled={busy}
        title="启动"
        aria-label={`启动 ${name}`}
        className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-accent hover:bg-surface-3 disabled:opacity-50"
      >
        <Play size={11} />
      </button>
    </div>
  );
}
