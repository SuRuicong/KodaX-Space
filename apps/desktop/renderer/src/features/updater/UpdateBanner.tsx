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
import { Download } from 'lucide-react';
import type { UpdaterStateT } from '@kodax-space/space-ipc-schema';
import { useI18n } from '../../i18n/I18nProvider.js';

export function UpdateBanner(): JSX.Element | null {
  const { t } = useI18n();
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
        <span>{t('update.checkFailed')}</span>
        <span className="text-fg-muted">— {state.message}</span>
      </BannerShell>
    );
  }

  if (state.state === 'available') {
    return (
      <BannerShell tone="info" onDismiss={() => setDismissed(true)}>
        <span>{t('update.available', { version: state.version })}</span>
        <span className="text-fg-muted">— {t('update.downloading')}</span>
      </BannerShell>
    );
  }

  if (state.state === 'downloading') {
    const pct = Math.round(state.percent);
    return (
      <BannerShell tone="info" onDismiss={() => setDismissed(true)}>
        <span>{t('update.downloadingVersion', { version: state.version })}</span>
        <span className="text-fg-muted font-mono">{pct}%</span>
      </BannerShell>
    );
  }

  // ready — call to action
  return (
    <BannerShell tone="success" onDismiss={() => setDismissed(true)}>
      <span>{t('update.ready', { version: state.version })}</span>
      <button
        type="button"
        onClick={install}
        disabled={installing}
        className="ml-2 px-2 py-0.5 text-xs rounded bg-ok/90 text-white hover:bg-ok border border-ok disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {installing ? t('update.installing') : t('update.restartInstall')}
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
  info: 'bg-surface-2 border-border-strong text-fg-primary',
  success: 'bg-surface-2 border-ok/50 text-ok',
  error: 'bg-surface-2 border-danger/50 text-danger',
};

function BannerShell(props: BannerShellProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
      <div
        role="status"
        className={`pointer-events-auto flex items-center gap-2 px-3 py-2 rounded border text-xs shadow-lg ${TONE_CLASS[props.tone]}`}
      >
        <Download className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} aria-hidden />
        {props.children}
        <button
          type="button"
          onClick={props.onDismiss}
          className="ml-1 dark:text-fg-muted dark:hover:text-white text-fg-muted hover:text-fg-primary px-0.5 leading-none"
          aria-label={t('common.dismiss')}
        >
          ×
        </button>
      </div>
    </div>
  );
}
