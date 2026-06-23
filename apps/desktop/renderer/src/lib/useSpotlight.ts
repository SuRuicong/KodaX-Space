// useSpotlight — F060 Liquid Glass 光标 specular 高光
//
// Linear/Cursor/visionOS 同款：柔光跟随光标在玻璃面板上移动，靠近的面板提亮。
// 关键：高光层是 .glass::after（radial-gradient，pointer-events:none）—— 全程不挡点击、
// 不移动任何布局，根治「整面板倾斜导致误点」。本 hook 只更新 CSS 变量 --mx/--my + .lit class。
//
// 两种聚光模式（按视觉质量档分流）：
//   · balanced（默认）→ 单卡聚光：每帧只点亮离光标最近的一块面板。鼠标移动最多触发一块
//     backdrop-filter 玻璃重绘，是「鼠标移动 → 核显拉满」的关键省点，观感近 Linear/Cursor。
//   · full（全特效）   → 多面板晕染：点亮 160px 内的所有面板（旧版观感，部分客户偏爱的弥漫感）。
//     full 本就是「要最强特效、接受更高开销」的档位，故在此恢复多面板。
// 公共：rAF 节流，pointermove passive；几何（querySelectorAll + rect）只在指针移动那一帧读，
// 空闲 / 纯流式输出时完全不跑。仅 balanced/full 档挂监听（minimal 不挂，高光 opacity 恒为 0）。

import { useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';

const NEAR = 160; // 光标进入面板外扩 160px 视为「近」，开始显高光

export function useSpotlight(): void {
  const quality = useAppStore((s) => s.visualQuality);

  useEffect(() => {
    if (quality === 'minimal') return undefined;
    const multi = quality === 'full'; // full：多面板晕染；balanced：单卡聚光

    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    let litEl: HTMLElement | null = null; // 仅单卡模式追踪当前点亮的那块

    const clearAllLit = (): void => {
      document
        .querySelectorAll<HTMLElement>('.glass.lit')
        .forEach((c) => c.classList.remove('lit'));
      litEl = null;
    };

    const lightPanel = (p: HTMLElement, r: DOMRect): void => {
      p.style.setProperty('--mx', `${(lastX - r.left).toFixed(0)}px`);
      p.style.setProperty('--my', `${(lastY - r.top).toFixed(0)}px`);
    };

    const apply = (): void => {
      raf = 0;
      const panels = document.querySelectorAll<HTMLElement>('.glass');

      if (multi) {
        // 多面板：每块独立判定是否在 NEAR 内，各自点亮（toggle 自动清掉离开的那些）。
        for (const p of panels) {
          const r = p.getBoundingClientRect();
          const near =
            lastX > r.left - NEAR &&
            lastX < r.right + NEAR &&
            lastY > r.top - NEAR &&
            lastY < r.bottom + NEAR;
          p.classList.toggle('lit', near);
          if (near) lightPanel(p, r);
        }
        return;
      }

      // 单卡：找离光标最近、且在 NEAR 阈值内的单块面板（rect 内距离为 0）。
      let best: HTMLElement | null = null;
      let bestRect: DOMRect | null = null;
      let bestDist = Infinity;
      for (const p of panels) {
        const r = p.getBoundingClientRect();
        const dx = Math.max(r.left - lastX, 0, lastX - r.right);
        const dy = Math.max(r.top - lastY, 0, lastY - r.bottom);
        const dist = Math.hypot(dx, dy);
        if (dist <= NEAR && dist < bestDist) {
          bestDist = dist;
          best = p;
          bestRect = r;
        }
      }
      if (best !== litEl) {
        if (litEl) litEl.classList.remove('lit');
        litEl = best;
        if (best) best.classList.add('lit');
      }
      if (litEl && bestRect) lightPanel(litEl, bestRect);
    };

    const onMove = (e: PointerEvent): void => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (raf === 0) raf = requestAnimationFrame(apply);
    };
    const onLeave = (): void => clearAllLit();

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
      clearAllLit();
    };
  }, [quality]);
}
