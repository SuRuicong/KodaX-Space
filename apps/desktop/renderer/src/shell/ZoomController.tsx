// ZoomController — 浏览器式整窗缩放的交互层（v0.1.11）
//
// 状态在 store/zoomStore（单一真理源，菜单按钮也用）。这里只负责：
//   - Ctrl+鼠标滚轮 / Ctrl+= / Ctrl+- 步进，Ctrl+0 复位（对齐浏览器）
//   - 开屏把持久系数 apply 到 webFrame
//   - 每次缩放变化弹一个浏览器风格瞬时角标 "120%"（1.4s 淡出，点击复位）
//
// main.ts 已移除菜单 zoom role —— 键盘快捷键由此处统一处理，避免与菜单 accelerator 双触发跳两档。

import { useEffect, useRef, useState } from 'react';
import { useZoomStore, ZOOM_STEP } from '../store/zoomStore.js';

const BADGE_MS = 1400;

export function ZoomController(): JSX.Element | null {
  const factor = useZoomStore((s) => s.factor);
  const bump = useZoomStore((s) => s.bump);
  const stepZoom = useZoomStore((s) => s.stepZoom);
  const resetZoom = useZoomStore((s) => s.resetZoom);
  const applyPersisted = useZoomStore((s) => s.applyPersisted);

  const [badgeVisible, setBadgeVisible] = useState(false);
  const hideTimer = useRef<number | null>(null);

  // 开屏把持久系数写进 webFrame（Electron 默认每次启动是 100%）。不弹角标。
  useEffect(() => {
    applyPersisted();
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [applyPersisted]);

  // 任意来源（滚轮/键盘/菜单）的缩放变化都让角标闪一下。跳过首个 bump（挂载初值），避免开屏弹。
  const firstBump = useRef(true);
  useEffect(() => {
    if (firstBump.current) {
      firstBump.current = false;
      return;
    }
    setBadgeVisible(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setBadgeVisible(false), BADGE_MS);
  }, [bump]);

  // Ctrl + 滚轮：非 passive 才能 preventDefault，由我们独占缩放。非 Ctrl 滚动不受影响。
  useEffect(() => {
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      stepZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP); // 上滚放大、下滚缩小
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [stepZoom]);

  // Ctrl+= / Ctrl++ 放大；Ctrl+- / Ctrl+_ 缩小；Ctrl+0 复位（对齐浏览器）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        stepZoom(ZOOM_STEP);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        stepZoom(-ZOOM_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepZoom, resetZoom]);

  if (!badgeVisible) return null;

  const percent = Math.round(factor * 100);
  return (
    <button
      type="button"
      onClick={resetZoom}
      title="点击复位 100%（Ctrl+0）"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-3 py-1.5 rounded-full
                 bg-surface-2/90 border border-border-strong text-fg-primary text-xs font-mono shadow-xl
                 backdrop-blur-sm flex items-center gap-2 select-none cursor-pointer
                 hover:bg-hover-bg transition-colors"
    >
      <span className="tabular-nums">{percent}%</span>
      {percent !== 100 && <span className="text-[11px] text-fg-muted">Ctrl+0 复位</span>}
    </button>
  );
}
