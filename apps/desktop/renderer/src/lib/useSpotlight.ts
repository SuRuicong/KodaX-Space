// useSpotlight — F060 Liquid Glass 光标 specular 高光
//
// Linear/Cursor/visionOS 同款：柔光跟随光标在玻璃面板上移动，靠近的面板边缘/表面提亮。
// 关键：高光层是 .glass::after（radial-gradient，pointer-events:none）—— 全程不挡点击、
// 不移动任何布局，根治「整面板倾斜导致误点」。本 hook 只更新 CSS 变量 --mx/--my + .lit class。
//
// 性能：pointermove 用 rAF 节流；每帧只对少量 .glass 面板做 getBoundingClientRect。
// 仅 balanced/full 档启用（minimal 不挂监听，高光 opacity 恒为 0）。

import { useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';

const NEAR = 160; // 光标进入面板外扩 160px 视为「近」，开始显高光

export function useSpotlight(): void {
  const quality = useAppStore((s) => s.visualQuality);

  useEffect(() => {
    if (quality === 'minimal') return undefined;

    let raf = 0;
    let lastX = 0;
    let lastY = 0;

    const apply = (): void => {
      raf = 0;
      const cards = document.querySelectorAll<HTMLElement>('.glass');
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        const near =
          lastX > r.left - NEAR &&
          lastX < r.right + NEAR &&
          lastY > r.top - NEAR &&
          lastY < r.bottom + NEAR;
        c.classList.toggle('lit', near);
        if (near) {
          c.style.setProperty('--mx', `${(lastX - r.left).toFixed(0)}px`);
          c.style.setProperty('--my', `${(lastY - r.top).toFixed(0)}px`);
        }
      }
    };
    const onMove = (e: PointerEvent): void => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (raf === 0) raf = requestAnimationFrame(apply);
    };
    const onLeave = (): void => {
      document.querySelectorAll<HTMLElement>('.glass.lit').forEach((c) => c.classList.remove('lit'));
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
      document.querySelectorAll<HTMLElement>('.glass.lit').forEach((c) => c.classList.remove('lit'));
    };
  }, [quality]);
}
