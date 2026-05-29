// McpPanel — FEATURE_036 + lifecycle (v0.1.x, Batch 3 #5 follow-up)
//
// 两个数据源:
//   1) mcp.servers  — McpManager.listServers (runtime status, 不触发连接)
//   2) mcp.discover — 文件级配置投影 (展示 source / command / envCount, 给"没连接过的 server
//      显示出原始命令行"用)
//
// UI:
//   - 顶部 status badge + Refresh / Reload (config) 按钮
//   - 每个 server 一行: name + transport + status + tools-count + Start/Stop + 错误显示
//   - 点 server 名展开 tools 列表 (mcp.tools 拉, lazy connect, 缓存到 expandedTools state)
//   - lastError 显示在状态行下方 (status=error 时)

import { useEffect, useState } from 'react';
import type {
  McpServerMeta,
  McpServerStatusT,
  McpRuntimeStatusT,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';

const STATUS_COLOR: Record<McpRuntimeStatusT, string> = {
  idle: 'text-zinc-500',
  connecting: 'text-amber-400',
  ready: 'text-emerald-400',
  error: 'text-red-400',
  disabled: 'text-zinc-600',
};
const STATUS_ICON: Record<McpRuntimeStatusT, string> = {
  idle: '○',
  connecting: '⟳',
  ready: '●',
  error: '✕',
  disabled: '—',
};

interface ToolItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export function McpPanel(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [statusList, setStatusList] = useState<readonly McpServerStatusT[]>([]);
  const [meta, setMeta] = useState<readonly McpServerMeta[]>([]);
  const [discoverErrors, setDiscoverErrors] = useState<ReadonlyArray<{ path: string; error: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [topErr, setTopErr] = useState<string | null>(null);
  // 操作中的 serverId (start/stop 期间禁按钮)
  const [busyServer, setBusyServer] = useState<string | null>(null);
  // 哪些 server 当前展开 tools 列表 (Map<serverId, ToolItem[] | 'loading'>)
  const [expandedTools, setExpandedTools] = useState<Record<string, ToolItem[] | 'loading' | 'error'>>({});

  async function refresh(): Promise<void> {
    if (!window.kodaxSpace) return;
    setLoading(true);
    setTopErr(null);
    try {
      // 并发拉 servers (lifecycle status) + discover (config 投影)。两者独立: 没启动过的 server
      // discover 出现但 statusList 缺 — UI 用 meta 补 command 等展示。
      const [statusR, discoverR] = await Promise.all([
        window.kodaxSpace.invoke('mcp.servers', undefined),
        currentSessionId
          ? window.kodaxSpace.invoke('mcp.discover', { sessionId: currentSessionId })
          : Promise.resolve(null),
      ]);
      if (!statusR.ok) {
        setTopErr(`mcp.servers: ${statusR.error?.message ?? 'unknown'}`);
        setStatusList([]);
      } else {
        setStatusList(statusR.data.servers);
      }
      if (discoverR && discoverR.ok) {
        setMeta(discoverR.data.servers);
        setDiscoverErrors(discoverR.data.errors);
      } else {
        setMeta([]);
        setDiscoverErrors([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  async function startServer(serverId: string): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusyServer(serverId);
    try {
      const r = await window.kodaxSpace.invoke('mcp.start', { serverId });
      if (r.ok) {
        setStatusList((cur) => cur.map((s) => (s.serverId === serverId ? r.data.status : s)));
      } else {
        setTopErr(`start ${serverId}: ${r.error?.message ?? 'failed'}`);
      }
    } finally {
      setBusyServer(null);
    }
  }

  async function stopServer(serverId: string): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusyServer(serverId);
    try {
      const r = await window.kodaxSpace.invoke('mcp.stop', { serverId });
      if (r.ok) {
        setStatusList((cur) => cur.map((s) => (s.serverId === serverId ? r.data.status : s)));
      } else {
        setTopErr(`stop ${serverId}: ${r.error?.message ?? 'failed'}`);
      }
    } finally {
      setBusyServer(null);
    }
  }

  async function reload(): Promise<void> {
    if (!window.kodaxSpace) return;
    setLoading(true);
    setTopErr(null);
    try {
      const r = await window.kodaxSpace.invoke('mcp.reload', undefined);
      if (!r.ok) {
        setTopErr(`reload failed`);
      }
      // 不管成功失败,重新拉一次 — reload 后状态全 reset 了
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function toggleTools(serverId: string): Promise<void> {
    if (!window.kodaxSpace) return;
    if (expandedTools[serverId]) {
      // 已展开 → 折叠
      setExpandedTools((cur) => {
        const next = { ...cur };
        delete next[serverId];
        return next;
      });
      return;
    }
    setExpandedTools((cur) => ({ ...cur, [serverId]: 'loading' }));
    const r = await window.kodaxSpace.invoke('mcp.tools', { serverId });
    if (!r.ok) {
      setExpandedTools((cur) => ({ ...cur, [serverId]: 'error' }));
      return;
    }
    setExpandedTools((cur) => ({ ...cur, [serverId]: r.data.tools as ToolItem[] }));
  }

  // 合并 statusList + meta(discover) 成统一视图:status 优先,meta 仅给"command/url"补展示
  const metaById = new Map(meta.map((m) => [m.name, m]));
  const allServerIds = new Set<string>();
  for (const s of statusList) allServerIds.add(s.serverId);
  for (const m of meta) allServerIds.add(m.name);
  const merged = Array.from(allServerIds).map((id) => ({
    serverId: id,
    status: statusList.find((s) => s.serverId === id),
    meta: metaById.get(id),
  }));

  return (
    <div className="h-full flex flex-col text-xs">
      <header className="px-3 py-2 border-b border-zinc-800/60 flex items-center justify-between flex-shrink-0">
        <div className="text-zinc-300 font-medium">
          MCP servers{' '}
          <span className="text-zinc-500 font-normal">({merged.length})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="px-2 py-0.5 text-[10px] rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            title="Refresh status"
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="px-2 py-0.5 text-[10px] rounded bg-amber-600/40 text-amber-200 hover:bg-amber-600/60 disabled:opacity-50"
            title="Reload config + reconstruct manager (call after editing ~/.kodax/config.json)"
          >
            ⟲ Reload config
          </button>
        </div>
      </header>

      {topErr !== null && (
        <div className="px-3 py-1 text-[11px] text-red-400 font-mono border-b border-zinc-900">
          {topErr}
        </div>
      )}

      <div className="flex-1 overflow-auto px-2 py-2 space-y-1.5">
        {merged.length === 0 && !loading && (
          <div className="text-zinc-600 text-center py-8 text-[11px]">
            No MCP servers configured. Add{' '}
            <code className="text-zinc-400 bg-zinc-900 px-1 rounded">mcpServers</code> to{' '}
            <code className="text-zinc-400 bg-zinc-900 px-1 rounded">~/.kodax/config.json</code>.
          </div>
        )}

        {merged.map((row) => {
          const status = row.status;
          const m = row.meta;
          const sStatus: McpRuntimeStatusT = status?.status ?? 'idle';
          const tools = status?.tools ?? 0;
          const isBusy = busyServer === row.serverId;
          const toolsState = expandedTools[row.serverId];
          return (
            <div key={row.serverId} className="border border-zinc-800/60 rounded bg-zinc-900/30">
              <div className="px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`${STATUS_COLOR[sStatus]} font-mono`}
                    aria-hidden
                    title={sStatus}
                  >
                    {STATUS_ICON[sStatus]}
                  </span>
                  <span className="font-mono text-zinc-200 truncate flex-1">{row.serverId}</span>
                  <span className={`text-[10px] font-mono ${STATUS_COLOR[sStatus]}`}>{sStatus}</span>
                  {tools > 0 && (
                    <span className="text-[10px] text-zinc-500 font-mono">{tools} tools</span>
                  )}
                  {status === undefined && (
                    <span className="text-[10px] text-zinc-600 italic">not in manager</span>
                  )}
                </div>
                {m && m.transport === 'stdio' && (
                  <div className="mt-1 text-zinc-500 font-mono text-[10px] truncate" title={`${m.command ?? ''} ${(m.args ?? []).join(' ')}`}>
                    {m.command} {(m.args ?? []).join(' ')}
                  </div>
                )}
                {m && m.transport === 'http' && (
                  <div className="mt-1 text-zinc-500 font-mono text-[10px] truncate" title={m.url}>
                    {m.url}
                  </div>
                )}
                {status?.lastError && (
                  <div className="mt-1 text-red-400/80 text-[10px] font-mono break-words">
                    {status.lastError}
                  </div>
                )}
                <div className="mt-1.5 flex gap-1.5 items-center">
                  {status && status.status !== 'ready' && status.status !== 'connecting' && (
                    <button
                      type="button"
                      onClick={() => void startServer(row.serverId)}
                      disabled={isBusy}
                      className="px-2 py-0.5 text-[10px] rounded bg-emerald-600/30 text-emerald-200 hover:bg-emerald-600/50 disabled:opacity-50"
                    >
                      {isBusy ? '…' : 'Start'}
                    </button>
                  )}
                  {status && (status.status === 'ready' || status.status === 'connecting') && (
                    <button
                      type="button"
                      onClick={() => void stopServer(row.serverId)}
                      disabled={isBusy}
                      className="px-2 py-0.5 text-[10px] rounded bg-zinc-700/60 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
                    >
                      {isBusy ? '…' : 'Stop'}
                    </button>
                  )}
                  {status && tools > 0 && (
                    <button
                      type="button"
                      onClick={() => void toggleTools(row.serverId)}
                      className="px-2 py-0.5 text-[10px] rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    >
                      {toolsState ? '▾ Tools' : '▸ Tools'}
                    </button>
                  )}
                </div>
              </div>
              {Array.isArray(toolsState) && (
                <div className="border-t border-zinc-800 px-2 py-1.5 space-y-0.5">
                  {toolsState.length === 0 ? (
                    <div className="text-zinc-500 italic text-[10px]">No tools.</div>
                  ) : (
                    toolsState.map((t) => (
                      <div key={t.id} className="text-[10px]">
                        <span className="font-mono text-zinc-300">{t.name}</span>
                        {t.description && (
                          <span className="text-zinc-500 ml-2">{t.description}</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
              {toolsState === 'loading' && (
                <div className="border-t border-zinc-800 px-2 py-1 text-zinc-500 italic text-[10px]">
                  Loading tools…
                </div>
              )}
              {toolsState === 'error' && (
                <div className="border-t border-zinc-800 px-2 py-1 text-red-400/80 text-[10px]">
                  Failed to load tools.
                </div>
              )}
            </div>
          );
        })}

        {discoverErrors.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1.5">
              Config errors ({discoverErrors.length})
            </div>
            <ul className="space-y-1">
              {discoverErrors.map((e, idx) => (
                <li key={`${e.path}:${idx}`} className="text-[10px] text-amber-400/70 font-mono">
                  <div className="truncate" title={e.path}>{e.path}</div>
                  <div className="text-amber-400/50 pl-2 truncate" title={e.error}>{e.error}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
