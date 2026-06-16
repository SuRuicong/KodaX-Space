// VisualQualityToggle — F060
//
// Titlebar 右侧 dropdown — 视觉质量三档快速切换（玻璃/景深/aurora 总开关）：
//   ┌──────────────────────────────────┐
//   │ 视觉质量                          │
//   │  ◍ 极简    实色无模糊 · 最省       │
//   │  ◐ 均衡    CSS 玻璃+极光      ✓   │
//   │  ✦ 全特效  WebGL 极光+厚玻璃       │
//   └──────────────────────────────────┘
//
// 行为对齐 ThemeToggle：点图标弹下拉、选一项立即生效并持久化、点外/Esc 关。
// 「不卡上全特效，卡就降均衡/极简」——纯手动配置，不做自动测帧降级（会因偶发卡顿误降）。

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import {
  applyVisualQualityToDocument,
  VISUAL_QUALITY_OPTIONS,
  type VisualQuality,
} from '../lib/visualQuality.js';

const ICON: Record<VisualQuality, string> = {
  minimal: '◍',
  balanced: '◐',
  full: '✦',
};

export function VisualQualityToggle(): JSX.Element {
  const quality = useAppStore((s) => s.visualQuality);
  const setVisualQuality = useAppStore((s) => s.setVisualQuality);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // 挂载时兜底同步一次 <html> class（index.html 预挂载与 store 理论一致；防版本升级漂移）。
  // 之后的切换由 setVisualQuality 自身 apply，无需在此重复。
  useEffect(() => {
    applyVisualQualityToDocument(useAppStore.getState().visualQuality);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocDown);
    };
  }, []);

  const current = VISUAL_QUALITY_OPTIONS.find((o) => o.key === quality) ?? VISUAL_QUALITY_OPTIONS[1];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ix-pop text-xs text-fg-muted hover:text-fg-primary px-1.5 py-0.5 rounded hover:bg-hover-bg flex items-center gap-1"
        title={`视觉质量：${current.label}`}
        aria-label={`Visual quality ${current.label}`}
      >
        <span aria-hidden>{ICON[quality]}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 text-xs z-50 lift">
          <div className="px-3 py-1 text-fg-muted text-[11px] uppercase tracking-wider">视觉质量</div>
          {VISUAL_QUALITY_OPTIONS.map((o) => {
            const selected = o.key === quality;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => {
                  setVisualQuality(o.key);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 hover:bg-hover-bg flex items-start gap-2 ${
                  selected ? 'text-fg-primary' : 'text-fg-secondary'
                }`}
              >
                <span className="w-4 mt-0.5" aria-hidden>
                  {ICON[o.key]}
                </span>
                <span className="flex-1">
                  <span className="block">{o.label}</span>
                  <span className="block text-[10.5px] text-fg-muted">{o.hint}</span>
                </span>
                {selected && (
                  <span className="text-ok mt-0.5" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
