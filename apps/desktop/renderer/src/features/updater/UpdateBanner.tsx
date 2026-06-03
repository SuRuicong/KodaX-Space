// Auto-update banner — F022 (v0.1.3)
//
// 订阅 'updater.status' push channel，弹出右下角浮窗。
// 状态 → UI 映射：
//   - idle / checking         → 不显示
//   - available               → "Update v0.1.4 available · Downloading…"
//   - downloading             → 同上 + percent
//   - ready                   → "Update v0.1.4 ready · [Restart & install]"
//   - error                   → "Update check failed · message"，30s 自动消失
//
// 用户点 ✕ 把当前 state 标记 dismissed，直到下一次 state 变化才重新显示
// （避免一直焦点干扰）。Restart & install 走 invoke 'updater.install'，
// main 内 100ms 后 quitAndInstall → renderer 此时已经 unmount，无需等待返回。

import { useCallback, useEffect, useState } from 'react';
import type { UpdaterStateT } from '@kodax-space/space-ipc-schema';

export function UpdateBanner(): JSX.Element | null {
  const [state, setState] = useState<UpdaterStateT>({ state: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  // v0.1.4 review LOW-4: renderer 侧也加一道 disable，跟 main 端 installing flag 一起防双击。
  // 第一次点完按钮立刻禁用，避免按钮闪烁期间用户连点造成双 install 请求。
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    const unsub = bridge.on('updater.status', (payload) => {
      setState(payload);
      setDismissed(false); // 任何新 state → 重新呈现
    });
    return () => unsub();
  }, []);

  const install = useCallback(async () => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    setInstalling(true);
    await bridge.invoke('updater.install', {}).catch(() => null);
    // 不 reset installing —— 成功调到 main 端 setTimeout 后 100ms 内进程就 quit 了。
    // 失败时 main push 一条 error state → useEffect 重新 setDismissed(false) 把 banner 转 error 态，
    // 不会留在 ready 态有"灰按钮无反应"问题。
  }, []);

  if (dismissed) return null;

  // idle / checking 不打扰用户
  if (state.state === 'idle' || state.state === 'checking') return null;

  // error 只显示一次，用户 ✕ 后不再纠缠
  if (state.state === 'error') {
    return (
      <BannerShell tone="error" onDismiss={() => setDismissed(true)}>
        <span>Update check failed</span>
        <span className="text-fg-muted">— {state.message}</span>
      </BannerShell>
    );
  }

  if (state.state === 'available') {
    return (
      <BannerShell tone="info" onDismiss={() => setDismissed(true)}>
        <span>
          KodaX Space <span className="font-mono">v{state.version}</span> available
        </span>
        <span className="text-fg-muted">— downloading…</span>
      </BannerShell>
    );
  }

  if (state.state === 'downloading') {
    const pct = Math.round(state.percent);
    return (
      <BannerShell tone="info" onDismiss={() => setDismissed(true)}>
        <span>
          Downloading <span className="font-mono">v{state.version}</span>
        </span>
        <span className="text-fg-muted font-mono">{pct}%</span>
      </BannerShell>
    );
  }

  // ready — call to action
  return (
    <BannerShell tone="success" onDismiss={() => setDismissed(true)}>
      <span>
        Update <span className="font-mono">v{state.version}</span> ready
      </span>
      <button
        type="button"
        onClick={install}
        disabled={installing}
        className="ml-2 px-2 py-0.5 text-[11px] rounded bg-emerald-700/90 text-white hover:bg-emerald-700 border border-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {installing ? 'Installing…' : 'Restart & install'}
      </button>
    </BannerShell>
  );
}

interface BannerShellProps {
  tone: 'info' | 'success' | 'error';
  onDismiss: () => void;
  children: React.ReactNode;
}

const TONE_CLASS: Record<BannerShellProps['tone'], string> = {
  info: 'dark:bg-zinc-800/95 dark:border-zinc-700 dark:text-zinc-100 bg-zinc-100 border-zinc-300 text-zinc-900',
  success: 'dark:bg-emerald-900/90 dark:border-emerald-700 dark:text-emerald-100 bg-emerald-50 border-emerald-300 text-emerald-900',
  error: 'dark:bg-red-900/90 dark:border-red-700 dark:text-red-100 bg-red-50 border-red-300 text-red-900',
};

function BannerShell(props: BannerShellProps): JSX.Element {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
      <div
        role="status"
        className={`pointer-events-auto flex items-center gap-2 px-3 py-2 rounded border text-xs shadow-lg ${TONE_CLASS[props.tone]}`}
      >
        <span aria-hidden>⤓</span>
        {props.children}
        <button
          type="button"
          onClick={props.onDismiss}
          className="ml-1 dark:text-zinc-400 dark:hover:text-white text-zinc-500 hover:text-zinc-900 px-0.5 leading-none"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
