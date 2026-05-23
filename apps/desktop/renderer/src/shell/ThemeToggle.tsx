// ThemeToggle — alpha.1
//
// 三档主题切换 (light / dark / system)。点击循环切；icon 反映当前 effective theme：
//   - dark: 月亮
//   - light: 太阳
//   - system: 半月（跟随 OS prefers-color-scheme）
//
// 切换时：
//   1. set zustand theme
//   2. <html> 加/去 'dark' class (Tailwind darkMode:'class' 生效；styles.css :root vs html.dark 切到对应色板)
//   3. 通过 IPC 通知 main 更新 BrowserWindow.titleBarOverlay 颜色 (Windows 才会真实生效)
//
// effective theme：'system' 时读 window.matchMedia('(prefers-color-scheme: dark)').matches

import { useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';

const DARK_OVERLAY = { color: '#0b0b0c', symbolColor: '#a1a1aa' };
const LIGHT_OVERLAY = { color: '#ffffff', symbolColor: '#3f3f46' };

function getEffectiveTheme(theme: 'dark' | 'light' | 'system'): 'dark' | 'light' {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }
  return theme;
}

export function applyThemeToDocument(theme: 'dark' | 'light' | 'system'): void {
  const eff = getEffectiveTheme(theme);
  if (eff === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
  // 通知 main 更新 Windows overlay 颜色（非 win 平台 main handler return ok 直接走）
  if (window.kodaxSpace) {
    void window.kodaxSpace.invoke(
      'titlebar.setOverlay',
      eff === 'dark' ? DARK_OVERLAY : LIGHT_OVERLAY,
    );
  }
}

export function ThemeToggle(): JSX.Element {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  // 启动期 + theme 改变时同步 <html> class 与 OS overlay 颜色
  useEffect(() => {
    applyThemeToDocument(theme);
    // 监听 system 偏好变化 — 仅 theme === 'system' 时响应
    if (theme === 'system' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = (): void => applyThemeToDocument('system');
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
    return undefined;
  }, [theme]);

  function cycle(): void {
    const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
    setTheme(next);
  }

  // 当前 icon
  const icon = theme === 'dark' ? '◐' : theme === 'light' ? '☀' : '◑';
  const label = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';

  return (
    <button
      type="button"
      onClick={cycle}
      className="text-[11px] text-fg-muted hover:text-fg-primary px-1.5 py-0.5 rounded hover:bg-hover-bg flex items-center gap-1"
      title={`Theme: ${label} — click to cycle`}
      aria-label={`Theme ${label}, click to cycle`}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}
