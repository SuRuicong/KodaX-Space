// Terminal — F011 真 PTY 单 tab 终端
//
// 内嵌 xterm.js 接 main 端 PtyHost；通过 terminal.* IPC channels 收发数据。
//
// 生命周期：
//   1. 组件 mount → 等当前 project 就绪 → terminal.create(cwd, cols, rows)
//   2. 拿到 terminalId → 订阅 push channel terminal.output + terminal.exit
//   3. xterm onData → debounce 写 terminal.write IPC
//   4. ResizeObserver + addon-fit → throttle terminal.resize
//   5. 组件 unmount / project 切换 / exit 事件 → terminal.kill
//
// 单 tab：当前只跑 1 个 PTY。F023 多 tab 时这层逻辑提到 TerminalManager。

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useAppStore } from '../../store/appStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';

interface Props {
  /** 关闭终端的回调 — popout 顶栏 X 按钮调，用来 unmount 触发 cleanup 流程 */
  readonly onClose?: () => void;
}

type LifecycleStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error';

export function Terminal({ onClose: _onClose }: Props): JSX.Element {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<LifecycleStatus>('idle');
  const [shellLabel, setShellLabel] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Mount xterm once
  useEffect(() => {
    if (containerRef.current === null) return;
    const xterm = new XTerm({
      cursorBlink: true,
      fontFamily: 'Menlo, Consolas, "Cascadia Mono", monospace',
      fontSize: 13,
      theme: {
        background: '#09090b',
        foreground: '#e4e4e7',
        cursor: '#a1a1aa',
        selectionBackground: 'rgba(255,255,255,0.18)',
      },
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    const webLinks = new WebLinksAddon();
    xterm.loadAddon(fit);
    xterm.loadAddon(webLinks);
    xterm.open(containerRef.current);
    fit.fit();
    xtermRef.current = xterm;
    fitAddonRef.current = fit;
    return () => {
      try {
        xterm.dispose();
      } catch {
        /* already disposed */
      }
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Create PTY when project becomes available; tear down when project changes / unmount
  useEffect(() => {
    if (!currentProjectPath || !window.kodaxSpace) {
      setStatus('idle');
      return;
    }
    const xterm = xtermRef.current;
    const fit = fitAddonRef.current;
    if (xterm === null || fit === null) return;

    let cancelled = false;
    // 本 effect-instance 自己的 pending id 引用 — cleanup 用它而不是 terminalIdRef
    // 来避免"create resolve 后才 unmount → cleanup 早跑没 id → PTY 孤儿"竞态。
    let pendingTerminalId: string | null = null;
    setStatus('starting');
    setErrorMsg(null);

    // Cols/rows from xterm after fit
    const cols = xterm.cols || 80;
    const rows = xterm.rows || 24;

    (async () => {
      const r = await window.kodaxSpace!.invoke('terminal.create', {
        cwd: currentProjectPath,
        cols,
        rows,
      });
      if (cancelled) {
        // Effect cleanup 已跑 — 立刻 kill 这个意外活下来的 PTY，否则它变孤儿
        if (r.ok && window.kodaxSpace) {
          void window.kodaxSpace.invoke('terminal.kill', { terminalId: r.data.terminalId });
        }
        return;
      }
      if (!r.ok) {
        setStatus('error');
        setErrorMsg(r.error?.message ?? t('terminal.startFailed'));
        xterm.write(`\r\n\x1b[31m${t('terminal.startFailed')}\x1b[0m\r\n`);
        return;
      }
      pendingTerminalId = r.data.terminalId;
      terminalIdRef.current = r.data.terminalId;
      setShellLabel(basename(r.data.shell));
      setStatus('running');
    })().catch((err: unknown) => {
      if (cancelled) return;
      setStatus('error');
      // 不把 err.message 原文写进 xterm — 防上游错误 string 泄露内部细节
      const msg = err instanceof Error ? err.message : t('terminal.unknownError');
      setErrorMsg(msg.length > 200 ? msg.slice(0, 200) : msg);
      xterm.write(`\r\n\x1b[31m${t('terminal.startFailed')}\x1b[0m\r\n`);
    });

    return () => {
      cancelled = true;
      // 优先用本 effect-instance 的 pendingTerminalId（即使 ref 已经被新一轮 effect 覆盖）
      const tid = pendingTerminalId ?? terminalIdRef.current;
      if (tid !== null && window.kodaxSpace) {
        void window.kodaxSpace.invoke('terminal.kill', { terminalId: tid });
      }
      // 只在 ref 还指向本 instance 的 id 时清掉 — 防覆盖下一轮 effect 已写的新 id
      if (terminalIdRef.current === pendingTerminalId) {
        terminalIdRef.current = null;
      }
    };
  }, [currentProjectPath, t]);

  // Wire xterm input → IPC write (debounced is unnecessary — node-pty handles single chars)
  useEffect(() => {
    const xterm = xtermRef.current;
    if (xterm === null) return;
    const dispose = xterm.onData((data) => {
      const tid = terminalIdRef.current;
      if (tid === null || !window.kodaxSpace) return;
      // Cap single write at 64 KB to match schema; paste of huge buffer chunked here
      let remaining = data;
      while (remaining.length > 0) {
        const chunk = remaining.slice(0, 65_536);
        remaining = remaining.slice(chunk.length);
        void window.kodaxSpace.invoke('terminal.write', { terminalId: tid, data: chunk });
      }
    });
    return () => {
      dispose.dispose();
    };
  }, []);

  // Subscribe to push terminal.output + terminal.exit
  useEffect(() => {
    if (!window.kodaxSpace) return;
    const offOutput = window.kodaxSpace.on('terminal.output', (payload) => {
      const tid = terminalIdRef.current;
      if (tid === null || payload.terminalId !== tid) return;
      xtermRef.current?.write(payload.data);
    });
    const offExit = window.kodaxSpace.on('terminal.exit', (payload) => {
      const tid = terminalIdRef.current;
      if (tid === null || payload.terminalId !== tid) return;
      setStatus('exited');
      const xterm = xtermRef.current;
      if (xterm) {
        const codeStr =
          payload.exitCode !== null ? `exit ${payload.exitCode}` : (payload.signal ?? 'terminated');
        xterm.write(`\r\n\x1b[90m[${codeStr}]\x1b[0m\r\n`);
      }
      terminalIdRef.current = null;
    });
    return () => {
      offOutput();
      offExit();
    };
  }, []);

  // ResizeObserver → fit + send resize to PTY (throttled)
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const fit = fitAddonRef.current;
        const xterm = xtermRef.current;
        if (fit === null || xterm === null) return;
        // F023 fix: tab 隐藏时 container offsetWidth/Height = 0 → fit() 算出 cols=1/rows=1
        // → PTY 收到 SIGWINCH(1x1) → shell prompt 折行炸 scrollback。
        // Skip resize 直到容器再次有真实尺寸。
        if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
        try {
          fit.fit();
        } catch {
          /* container detached mid-resize */
          return;
        }
        const tid = terminalIdRef.current;
        if (tid === null || !window.kodaxSpace) return;
        void window.kodaxSpace.invoke('terminal.resize', {
          terminalId: tid,
          cols: Math.max(1, xterm.cols),
          rows: Math.max(1, xterm.rows),
        });
      }, 80);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
    };
  }, []);

  return (
    <div className="h-full flex flex-col bg-surface">
      <div className="px-3 py-1 border-b border-border-default/60 flex items-center gap-2 text-xs text-fg-muted flex-shrink-0">
        <span className="text-fg-muted">{t('terminal.title')}</span>
        {shellLabel && <span className="text-fg-faint">· {shellLabel}</span>}
        <span className="ml-auto">
          {status === 'starting' && (
            <span className="text-warn">{t('terminal.status.starting')}</span>
          )}
          {status === 'running' && <span className="text-ok">●</span>}
          {status === 'exited' && (
            <span className="text-fg-faint">{t('terminal.status.exited')}</span>
          )}
          {status === 'error' && <span className="text-danger">{t('terminal.status.error')}</span>}
        </span>
      </div>
      {status === 'idle' && !currentProjectPath && (
        <div className="p-4 text-xs text-fg-muted">{t('terminal.openProject')}</div>
      )}
      {errorMsg !== null && status === 'error' && (
        <div className="px-3 py-1 text-xs text-danger bg-danger/12 flex-shrink-0">{errorMsg}</div>
      )}
      <div ref={containerRef} className="flex-1 min-h-0 px-1 py-1 overflow-hidden" />
    </div>
  );
}

function basename(p: string): string {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return slash >= 0 ? p.slice(slash + 1) : p;
}
