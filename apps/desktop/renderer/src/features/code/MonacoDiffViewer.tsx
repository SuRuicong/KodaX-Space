// Monaco diff viewer — F009.
//
// 左 before / 右 after。Read-only。语言从 path 推断（两侧同 language——同一文件的版本对比）。

import { useEffect } from 'react';
import { DiffEditor, type Monaco } from '@monaco-editor/react';
import { initMonacoOnce } from './monaco-setup.js';
import { languageFromPath } from './language-detect.js';

interface MonacoDiffViewerProps {
  path: string;
  before: string;
  after: string;
}

export function MonacoDiffViewer({ path, before, after }: MonacoDiffViewerProps): JSX.Element {
  useEffect(() => {
    initMonacoOnce();
  }, []);

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
  };

  return (
    <DiffEditor
      height="100%"
      width="100%"
      original={before}
      modified={after}
      originalLanguage={languageFromPath(path)}
      modifiedLanguage={languageFromPath(path)}
      theme="kodax-space-dark"
      beforeMount={handleBeforeMount}
      options={{
        readOnly: true,
        renderSideBySide: true,
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
