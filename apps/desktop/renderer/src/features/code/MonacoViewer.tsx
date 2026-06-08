// Monaco read-only file viewer — F009.
//
// 单文件视图：read-only，主题贴 zinc-950 暗色背景。语言从 path 扩展名推断。
// 不接 language services（ts/json/css/html worker）—— 详见 monaco-setup.ts。

import { useEffect, useRef } from 'react';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { initMonacoOnce } from './monaco-setup.js';
import { languageFromPath } from './language-detect.js';

interface MonacoViewerProps {
  path: string;
  content: string;
}

export function MonacoViewer({ path, content }: MonacoViewerProps): JSX.Element {
  const editorRef = useRef<unknown>(null);

  useEffect(() => {
    initMonacoOnce();
  }, []);

  const handleBeforeMount = (monaco: Monaco): void => {
    // 自定义主题贴 app 的 zinc-950 背景；避免 Monaco 默认 vs-dark 偏蓝
    monaco.editor.defineTheme('kodax-space-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#09090b', // zinc-950
        'editor.foreground': '#e4e4e7', // zinc-200
        'editorLineNumber.foreground': '#52525b', // zinc-600
        'editorLineNumber.activeForeground': '#a1a1aa', // zinc-400
        'editor.lineHighlightBackground': '#18181b', // zinc-900
        'editorCursor.foreground': '#71717a', // zinc-500
      },
    });
  };

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  return (
    <Editor
      height="100%"
      width="100%"
      path={path}
      language={languageFromPath(path)}
      value={content}
      theme="kodax-space-dark"
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
        lineNumbers: 'on',
        renderLineHighlight: 'none',
        wordWrap: 'off',
        smoothScrolling: true,
        cursorBlinking: 'solid',
        cursorStyle: 'line',
        // 隐藏 readonly tooltip 闪一下"Cannot edit..."
        readOnlyMessage: { value: '' },
      }}
      loading={<div className="text-xs text-fg-muted p-2">loading editor…</div>}
    />
  );
}
