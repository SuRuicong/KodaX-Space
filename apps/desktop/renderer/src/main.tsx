import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// F054 视觉刷新：本地打包字体 (Electron 无网 + CSP)，不走 Google Fonts CDN。
// Variable 字体单文件覆盖全字重；--ui / --mono 在 styles.css 指向它们。
import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

// v0.1.3.1 修复 F019 FOUC：在 React render 之前同步把 theme class 打到 <html>，
// 防"启动一帧暗色 → 用户的 light/system 偏好生效后再切"的视觉闪屏。
// 这里直接读 localStorage 不走 lsGet helper —— renderer 启动期 try/catch 简单：私模 / 测试
// 环境下读取抛 SecurityError 就退回 'dark'（与 store 行为一致）。
(function applyInitialTheme(): void {
  try {
    const stored = localStorage.getItem('kodax-space.theme');
    const theme = stored === 'light' || stored === 'system' || stored === 'dark' ? stored : 'dark';
    let effective: 'dark' | 'light';
    if (theme === 'system') {
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else {
      effective = theme;
    }
    if (effective === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  } catch {
    document.documentElement.classList.add('dark');
  }
})();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('root element not found');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
