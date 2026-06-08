// zoomStore — 浏览器式整窗缩放的共享状态（v0.1.11）
//
// 单一真理源：键盘/滚轮（ZoomController）和菜单按钮（TranscriptViewMenu 的 Zoom 行）都走这里，
// 保证显示的系数永远一致。缩放走 Electron webFrame（整窗 Chromium zoom），系数持久化 localStorage。

import { create } from 'zustand';

export const ZOOM_MIN = 0.5; //  50%
export const ZOOM_MAX = 3.0; // 300%
export const ZOOM_STEP = 0.1; // 每档 10%，对齐浏览器手感
const STORAGE_KEY = 'kodax.zoomFactor';

function clamp(f: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, f));
}
// 量化到 0.1 步，消除浮点漂移（0.1+0.2 之类）
function quantize(f: number): number {
  return Math.round(clamp(f) * 10) / 10;
}

function readPersisted(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 1;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? quantize(n) : 1;
  } catch {
    return 1;
  }
}

interface ZoomState {
  /** 当前缩放系数（1 = 100%）。 */
  factor: number;
  /** 用户每次主动改缩放自增——ZoomController 据此弹瞬时角标（含菜单点击触发的变化）。 */
  bump: number;
  /** 设为某系数：clamp+quantize → webFrame → localStorage → state。值到边界不变也自增 bump（让角标闪一下）。 */
  setZoom(factor: number): void;
  /** 相对步进（+/-ZOOM_STEP）。 */
  stepZoom(delta: number): void;
  /** 复位 100%。 */
  resetZoom(): void;
  /** 开屏把持久系数写进 webFrame（Electron 每次启动默认 100%）。不弹角标、不自增 bump。 */
  applyPersisted(): void;
}

export const useZoomStore = create<ZoomState>((set, get) => ({
  factor: readPersisted(),
  bump: 0,
  setZoom: (factor) => {
    const q = quantize(factor);
    window.kodaxSpace?.zoom?.set(q);
    try {
      localStorage.setItem(STORAGE_KEY, String(q));
    } catch {
      /* localStorage 不可用（隐私模式/配额满）—— 静默；缩放仍生效，只是不持久 */
    }
    set((s) => ({ factor: q, bump: s.bump + 1 }));
  },
  stepZoom: (delta) => get().setZoom(get().factor + delta),
  resetZoom: () => get().setZoom(1),
  applyPersisted: () => {
    const q = readPersisted();
    window.kodaxSpace?.zoom?.set(q);
    set({ factor: q });
  },
}));
