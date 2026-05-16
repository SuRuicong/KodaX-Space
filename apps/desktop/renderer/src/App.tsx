import { useEffect, useState } from 'react';
import type { SpaceVersionOutput } from '@kodax-space/space-ipc-schema';

/**
 * FEATURE_001/002 自检 UI：验证三进程模型 + IPC 桥 + zod schema 往返。
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

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (bridge) {
      setPlatform(bridge.platform);
      setBridgeOk(true);
    }

    // 安全基线自检：renderer 不应有 require / process / Buffer
    const leak =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (window as any).require === 'function' ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (window as any).process === 'object';
    setNodeLeak(leak);

    // FEATURE_002 往返自检：调 space.version，验证 schema/envelope/preload allowlist 全链路
    if (bridge) {
      bridge
        .invoke('space.version', undefined)
        .then((result) => {
          if (result.ok) {
            setVersionResult({ status: 'ok', data: result.data });
          } else {
            setVersionResult({ status: 'fail', message: `${result.error.code}: ${result.error.message}` });
          }
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setVersionResult({ status: 'fail', message: `invoke rejected: ${msg}` });
        });
    }
  }, []);

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
        <div className="max-w-2xl mx-auto space-y-6">
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
              {versionResult.status === 'fail' && (
                <div className="text-red-400">FAIL — {versionResult.message}</div>
              )}
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
            <h2 className="text-sm font-medium text-zinc-400 mb-2">Next up</h2>
            <ul className="text-sm text-zinc-300 space-y-1 list-disc list-inside">
              <li>FEATURE_003 — Main 进程 KodaX runtime 集成（in-process import）</li>
              <li>FEATURE_004 — Provider 配置 GUI + Keychain</li>
              <li>FEATURE_005 — 项目与 Session 管理 UI</li>
            </ul>
          </section>
        </div>
      </main>

      <footer className="border-t border-zinc-800 px-6 py-2 text-xs text-zinc-500 flex justify-between">
        <span>
          docs: <code className="font-mono text-zinc-400">docs/PRD.md</code> ·{' '}
          <code className="font-mono text-zinc-400">docs/HLD.md</code>
        </span>
        <span>FEATURE_002 scaffold</span>
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
