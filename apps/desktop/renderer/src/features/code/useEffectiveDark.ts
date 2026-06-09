// 共享 hook：根据 app 主题 (store.theme + system fallback) 判断当前是否暗色。
// Monaco 编辑器 / diff viewer 用来在 light/dark 间切自定义主题（F054）。
// 'system' 走 prefers-color-scheme media query，跟系统主题变化实时联动。

import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore.js';

export function useEffectiveDark(): boolean {
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
