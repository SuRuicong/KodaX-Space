// Monaco read-only file viewer — F009 / F054 双主题。
//
// 单文件视图：read-only，主题随 app 切 light/dark（F054：之前写死暗色，浅色主题下
// 编辑器仍是黑的，与周围 UI 撞色）。语言从 path 扩展名推断。
// 不接 language services（ts/json/css/html worker）—— 详见 monaco-setup.ts。

import { useEffect, useRef } from 'react';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { initMonacoOnce } from './monaco-setup.js';
import { languageFromPath } from './language-detect.js';
import { useEffectiveDark } from './useEffectiveDark.js';
import { useI18n } from '../../i18n/I18nProvider.js';

interface MonacoViewerProps {
  path: string;
  content: string;
}

export function MonacoViewer({ path, content }: MonacoViewerProps): JSX.Element {
  const { t } = useI18n();
  const editorRef = useRef<unknown>(null);
  const isDark = useEffectiveDark();

  useEffect(() => {
    initMonacoOnce();
  }, []);

  const handleBeforeMount = (monaco: Monaco): void => {
    // 自定义主题贴 app 背景；避免 Monaco 默认 vs-dark 偏蓝
    monaco.editor.defineTheme('kodax-space-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#09090b', // surface base (dark)
        'editor.foreground': '#e4e4e7',
        'editorLineNumber.foreground': '#52525b',
        'editorLineNumber.activeForeground': '#a1a1aa',
        'editor.lineHighlightBackground': '#18181b',
        'editorCursor.foreground': '#71717a',
      },
    });
    // F054：对称 light 主题，浅色用户不再看到黑底编辑器跟周围撞色（同 MonacoDiffViewer）
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
        'editorCursor.foreground': '#52525b',
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
      theme={isDark ? 'kodax-space-dark' : 'kodax-space-light'}
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
      loading={<div className="text-xs text-fg-muted p-2">{t('code.loadingEditor')}</div>}
    />
  );
}
