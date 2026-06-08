// Monaco diff viewer — F009.
//
// 左 before / 右 after。Read-only。语言从 path 推断（两侧同 language——同一文件的版本对比）。

import { useEffect, useState } from 'react';
import { DiffEditor, type Monaco } from '@monaco-editor/react';
import { initMonacoOnce } from './monaco-setup.js';
import { languageFromPath } from './language-detect.js';
import { useAppStore } from '../../store/appStore.js';

// v0.1.4 review C3-HIGH-1: 必须在 @monaco-editor/react 的 loader 启动之前完成
// loader.config({monaco})，否则会回退到默认 CDN 加载（CSP 禁止）。挪到 module
// top-level 同步执行 —— React.lazy 解析这个 chunk 时已经 import 求值过了，
// 比 useEffect 在第一帧 paint 之后才跑要早，能确保和 DiffEditor 的 beforeMount
// 之间不会出现"DiffEditor 已经 mount 但 loader 还没 config"的窗口。
//
// initMonacoOnce 自带 idempotent 守护，多 import / HMR 重复调没副作用。
initMonacoOnce();

interface MonacoDiffViewerProps {
  path: string;
  before: string;
  after: string;
}

/**
 * v0.1.4 review C3-MED 修复：根据 app 主题（store.theme + system fallback）切 light/dark。
 * 'system' 走 prefers-color-scheme media query，跟主题变化实时联动。
 */
function useEffectiveDark(): boolean {
  const theme = useAppStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true,
  );
  useEffect(() => {
    if (theme !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (): void => setSystemDark(mq.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [theme]);
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return systemDark;
}

export function MonacoDiffViewer({ path, before, after }: MonacoDiffViewerProps): JSX.Element {
  const isDark = useEffectiveDark();

  const handleBeforeMount = (monaco: Monaco): void => {
    monaco.editor.defineTheme('kodax-space-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#09090b',
        'editor.foreground': '#e4e4e7',
        'editorLineNumber.foreground': '#52525b',
        'editorLineNumber.activeForeground': '#a1a1aa',
        'editor.lineHighlightBackground': '#18181b',
        'diffEditor.insertedTextBackground': '#16a34a30', // green-600 30% alpha
        'diffEditor.removedTextBackground': '#dc262630', // red-600 30% alpha
      },
    });
    // v0.1.4 review C3-MED: 定义对称的 light 主题，避免 light 用户看 dark 编辑器跟周围 UI 撞色
    monaco.editor.defineTheme('kodax-space-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#18181b',
        'editorLineNumber.foreground': '#a1a1aa',
        'editorLineNumber.activeForeground': '#52525b',
        'editor.lineHighlightBackground': '#f4f4f5',
        'diffEditor.insertedTextBackground': '#22c55e33', // green-500 20% alpha
        'diffEditor.removedTextBackground': '#ef444433', // red-500 20% alpha
      },
    });
  };

  return (
    <DiffEditor
      height="100%"
      width="100%"
      original={before}
      modified={after}
      originalLanguage={languageFromPath(path)}
      modifiedLanguage={languageFromPath(path)}
      theme={isDark ? 'kodax-space-dark' : 'kodax-space-light'}
      beforeMount={handleBeforeMount}
      options={{
        readOnly: true,
        renderSideBySide: true,
        // F044 v0.1.10 fix: Monaco DiffEditor 默认在容器 < ~700px 时自动 fallback 到
        // inline (上下叠加),违背用户对"左右对比"的预期。我们把 PopoutOverlay 的 diff
        // 容器加宽到 880px (够 side-by-side),并显式禁用 limited-space 自动 fallback
        // 强制保持左右两列。
        useInlineViewWhenSpaceIsLimited: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
        renderOverviewRuler: false,
        // 折叠未改动段，焦点放在 diff
        hideUnchangedRegions: { enabled: true },
      }}
      loading={<div className="text-xs text-zinc-500 p-2">loading diff…</div>}
    />
  );
}
