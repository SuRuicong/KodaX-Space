// McpPanel — FEATURE_036 alpha.1 (read-only listing).
//
// 列已配置的 MCP server（global ~/.kodax/config.json + project ${root}/.kodax/config.json）。
// 数据通过 mcp.discover invoke 拉，每次打开 popout 都重拉一次——KodaX REPL 改完
// config.json 后下次打开即生效。
//
// 启停 / 日志 / tool catalog 暂不支持，UI 显示提示"管理功能 v0.1.7 接 SDK 后开放"。

import { useEffect, useState } from 'react';
import type { McpServerMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';

const TRANSPORT_BADGE: Record<McpServerMeta['transport'], string> = {
  stdio: 'stdio',
  http: 'http',
};

const TRANSPORT_COLOR: Record<McpServerMeta['transport'], string> = {
  stdio: 'text-emerald-400',
  http: 'text-sky-400',
};

interface DiscoverData {
  readonly servers: readonly McpServerMeta[];
  readonly errors: ReadonlyArray<{ path: string; error: string }>;
}

export function McpPanel(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [data, setData] = useState<DiscoverData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!currentSessionId || !window.kodaxSpace) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void window.kodaxSpace
      .invoke('mcp.discover', { sessionId: currentSessionId })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setErr(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'unknown error'}`);
          setData(null);
          return;
        }
        setData(r.data);
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
        Loading MCP servers…
      </div>
    );
  }

  if (err !== null) {
    return (
      <div className="h-full p-4 text-xs text-red-400 font-mono">Failed: {err}</div>
    );
  }

  const servers = data?.servers ?? [];
  const errors = data?.errors ?? [];

  return (
    <div className="h-full overflow-y-auto p-3 text-xs">
      {/* alpha.1 限制提示 */}
      <div className="mb-3 p-2 rounded bg-zinc-900/60 border border-zinc-800 text-zinc-500 text-[11px] leading-relaxed">
        <strong className="text-zinc-300">Read-only listing.</strong> Server start / stop /
        log / tool catalog management lands in v0.1.7 once KodaX SDK exposes the MCP
        manager API. Edit{' '}
        <code className="text-zinc-400">~/.kodax/config.json</code> directly to add /
        remove servers; reopen this popout to refresh.
      </div>

      {/* Server list */}
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
        Servers{' '}
        <span className="font-normal normal-case">
          ({servers.length} {servers.length === 1 ? 'server' : 'servers'})
        </span>
      </div>

      {servers.length === 0 ? (
        <div className="text-zinc-600">
          No MCP servers configured. Add a{' '}
          <code className="text-zinc-400 bg-zinc-900 px-1 rounded">mcpServers</code> object
          to{' '}
          <code className="text-zinc-400 bg-zinc-900 px-1 rounded">~/.kodax/config.json</code>.
        </div>
      ) : (
        <ul className="space-y-2">
          {servers.map((s) => (
            <li
              key={`${s.source}:${s.name}`}
              className="px-2 py-1.5 rounded bg-zinc-900/30 border border-zinc-800/60"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-zinc-200 truncate">{s.name}</span>
                <span className={`text-[10px] font-mono ${TRANSPORT_COLOR[s.transport]}`}>
                  {TRANSPORT_BADGE[s.transport]}
                </span>
                <span className="text-[9px] uppercase text-zinc-600 ml-auto">{s.source}</span>
              </div>
              {s.transport === 'stdio' && (
                <div className="mt-1 text-zinc-500 font-mono text-[10px] truncate" title={`${s.command ?? ''} ${(s.args ?? []).join(' ')}`}>
                  {s.command} {(s.args ?? []).join(' ')}
                </div>
              )}
              {s.transport === 'http' && (
                <div className="mt-1 text-zinc-500 font-mono text-[10px] truncate" title={s.url}>
                  {s.url}
                </div>
              )}
              {s.envCount > 0 && (
                <div className="mt-0.5 text-[10px] text-zinc-600">
                  {s.envCount} env var{s.envCount === 1 ? '' : 's'} (hidden)
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Parse errors（损坏 JSON / shape 不对的 server 条目） */}
      {errors.length > 0 && (
        <>
          <div className="mt-4 text-[10px] uppercase tracking-wider text-amber-400 mb-1.5">
            Errors ({errors.length})
          </div>
          <ul className="space-y-1">
            {errors.map((e, idx) => (
              <li key={`${e.path}:${idx}`} className="text-[10px] text-amber-400/70 font-mono">
                <div className="truncate" title={e.path}>{e.path}</div>
                <div className="text-amber-400/50 pl-2 truncate" title={e.error}>{e.error}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
