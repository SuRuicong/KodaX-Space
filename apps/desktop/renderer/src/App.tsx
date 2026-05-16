import { useEffect, useRef, useState } from 'react';
import type { SessionEvent, SpaceVersionOutput } from '@kodax-space/space-ipc-schema';

/**
 * FEATURE_001/002/003 自检 UI：验证三进程模型 + IPC 桥 + zod schema 往返 + session 事件流。
 *
 * 后续 feature 会替换这里：
 * - FEATURE_005: 项目与 Session 管理 UI（左抽屉）
 * - FEATURE_006: 对话流（主体）
 * - FEATURE_009: 文件面板（右抽屉）
 */
export default function App(): JSX.Element {
  const [platform, setPlatform] = useState<string>('unknown');
  const [bridgeOk, setBridgeOk] = useState<boolean>(false);
  const [nodeLeak, setNodeLeak] = useState<boolean | null>(null);
  const [versionResult, setVersionResult] = useState<
    { status: 'pending' } | { status: 'ok'; data: SpaceVersionOutput } | { status: 'fail'; message: string }
  >({ status: 'pending' });

  // FEATURE_003 demo state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState<string>('Read package.json and summarize');
  const [events, setEvents] = useState<readonly SessionEvent[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [sessionErr, setSessionErr] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (bridge) {
      setPlatform(bridge.platform);
      setBridgeOk(true);
    }

    const leak =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (window as any).require === 'function' ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (window as any).process === 'object';
    setNodeLeak(leak);

    if (bridge) {
      bridge
        .invoke('space.version', undefined)
        .then((result) => {
          if (result.ok) setVersionResult({ status: 'ok', data: result.data });
          else setVersionResult({ status: 'fail', message: `${result.error.code}: ${result.error.message}` });
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setVersionResult({ status: 'fail', message: `invoke rejected: ${msg}` });
        });

      // 全局订阅 session.event——renderer 端按 sessionId 过滤
      unsubRef.current = bridge.on('session.event', (payload) => {
        setEvents((prev) => [...prev, payload]);
      });
    }

    return () => {
      unsubRef.current?.();
    };
  }, []);

  async function handleCreate(): Promise<void> {
    if (!window.kodaxSpace) return;
    setSessionErr(null);
    setBusy(true);
    // Demo path——FEATURE_005 项目选择 UI 落地后这里换成用户实际选的 git root。
    // 平台相关，因为 main 端 validateProjectRoot 用 path.isAbsolute（Windows vs POSIX）。
    const demoRoot = window.kodaxSpace.platform === 'win32' ? 'C:\\demo\\project' : '/tmp/demo/project';
    try {
      const result = await window.kodaxSpace.invoke('session.create', {
        projectRoot: demoRoot,
        provider: 'mock',
        reasoningMode: 'auto',
      });
      if (result.ok) {
        setSessionId(result.data.sessionId);
        setEvents([]);
      } else {
        setSessionErr(`${result.error.code}: ${result.error.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSend(): Promise<void> {
    if (!window.kodaxSpace || !sessionId) return;
    setSessionErr(null);
    setBusy(true);
    try {
      const result = await window.kodaxSpace.invoke('session.send', {
        sessionId,
        prompt: promptDraft,
      });
      if (!result.ok) setSessionErr(`${result.error.code}: ${result.error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(): Promise<void> {
    if (!window.kodaxSpace || !sessionId) return;
    await window.kodaxSpace.invoke('session.cancel', { sessionId });
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden />
          <h1 className="text-lg font-semibold">KodaX Space</h1>
          <span className="text-xs text-zinc-500 font-mono">
            {versionResult.status === 'ok' ? `v${versionResult.data.spaceVersion}` : 'v?.?.?'}
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-auto px-6 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <section>
            <h2 className="text-sm font-medium text-zinc-400 mb-2">Scaffold self-check</h2>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 font-mono text-sm space-y-2">
              <Row label="Preload bridge" ok={bridgeOk} value={bridgeOk ? 'kodaxSpace ✓' : 'missing'} />
              <Row label="OS platform" ok={platform !== 'unknown'} value={platform} />
              <Row
                label="Node globals leaked"
                ok={nodeLeak === false}
                value={nodeLeak === null ? 'checking…' : nodeLeak ? 'YES (security bug!)' : 'no ✓'}
              />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium text-zinc-400 mb-2">IPC round-trip (space.version)</h2>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 font-mono text-sm space-y-2">
              {versionResult.status === 'pending' && <div className="text-zinc-500">calling…</div>}
              {versionResult.status === 'fail' && <div className="text-red-400">FAIL — {versionResult.message}</div>}
              {versionResult.status === 'ok' && (
                <>
                  <Row label="space" ok value={versionResult.data.spaceVersion} />
                  <Row label="electron" ok value={versionResult.data.electronVersion} />
                  <Row label="chromium" ok value={versionResult.data.chromeVersion} />
                  <Row label="node" ok value={versionResult.data.nodeVersion} />
                </>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium text-zinc-400 mb-2">
              Session event stream (FEATURE_003 · Mock adapter)
            </h2>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={busy || sessionId !== null}
                  className="px-3 py-1.5 text-sm rounded bg-emerald-700/80 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Create session
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={busy || sessionId === null}
                  className="px-3 py-1.5 text-sm rounded bg-blue-700/80 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Send prompt
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={sessionId === null}
                  className="px-3 py-1.5 text-sm rounded bg-zinc-700/80 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                {sessionId && (
                  <code className="ml-auto text-xs text-zinc-500 font-mono truncate max-w-[200px]" title={sessionId}>
                    {sessionId}
                  </code>
                )}
              </div>

              <input
                type="text"
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                placeholder="Prompt..."
                className="w-full px-3 py-2 text-sm rounded bg-zinc-950 border border-zinc-800 font-mono"
              />

              {sessionErr && <div className="text-red-400 text-sm font-mono">{sessionErr}</div>}

              <div className="rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs h-56 overflow-auto">
                {events.length === 0 && <div className="text-zinc-600">no events yet</div>}
                {events.map((evt, idx) => (
                  <EventLine key={idx} event={evt} />
                ))}
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium text-zinc-400 mb-2">Next up</h2>
            <ul className="text-sm text-zinc-300 space-y-1 list-disc list-inside">
              <li>FEATURE_004 — Provider 配置 GUI + Keychain</li>
              <li>FEATURE_005 — 项目与 Session 管理 UI</li>
              <li>FEATURE_006 — 对话流 UI + tool call 渲染</li>
            </ul>
          </section>
        </div>
      </main>

      <footer className="border-t border-zinc-800 px-6 py-2 text-xs text-zinc-500 flex justify-between">
        <span>
          docs: <code className="font-mono text-zinc-400">docs/PRD.md</code> ·{' '}
          <code className="font-mono text-zinc-400">docs/HLD.md</code>
        </span>
        <span>FEATURE_003 scaffold</span>
      </footer>
    </div>
  );
}

function Row({ label, ok, value }: { label: string; ok: boolean; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-400">{label}</span>
      <span className={ok ? 'text-emerald-400' : 'text-red-400'}>{value}</span>
    </div>
  );
}

function EventLine({ event }: { event: SessionEvent }): JSX.Element {
  const colorByKind: Record<SessionEvent['kind'], string> = {
    text_delta: 'text-zinc-200',
    thinking_delta: 'text-purple-400',
    tool_start: 'text-blue-400',
    tool_progress: 'text-blue-300',
    tool_result: 'text-emerald-400',
    iteration_end: 'text-amber-400',
    session_complete: 'text-emerald-500 font-semibold',
    session_error: 'text-red-400',
  };
  return (
    <div className={`whitespace-pre-wrap ${colorByKind[event.kind]}`}>
      <span className="text-zinc-600">[{event.kind}]</span> {formatEventBody(event)}
    </div>
  );
}

function formatEventBody(event: SessionEvent): string {
  switch (event.kind) {
    case 'text_delta':
    case 'thinking_delta':
      return event.text;
    case 'tool_start':
      return `${event.toolName}(${event.input ? JSON.stringify(event.input) : ''})`;
    case 'tool_progress':
      return event.message;
    case 'tool_result':
      return `${event.toolName} → ${event.content.slice(0, 80)}${event.content.length > 80 ? '…' : ''}`;
    case 'iteration_end':
      return `iter ${event.iter}/${event.maxIter} · ${event.tokenCount} tokens`;
    case 'session_complete':
      return '✓ complete';
    case 'session_error':
      return event.error;
  }
}
