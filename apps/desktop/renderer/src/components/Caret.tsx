// Caret — 全 app 统一的折叠/展开（及"前进/可展开"）chevron。
//
// 细描边 chevron-right（Lucide/Heroicons 风格 SVG）：open=false 指右、open=true 旋转 90° 朝下，
// 带 200ms 过渡；stroke=currentColor **继承父元素文字色**，hover 跟随变亮，整行像一个可点单元。
// 取代历史上零散的 `›⌄` / `▸▾` / `▶▼` 多套 unicode 字形（用户反馈太小、不一致、实心三角丑，
// 2026-06-08）。矢量描边在任何缩放/DPI 下都锐利，是现代 Tailwind 站点的通行做法。
//
// 用于：
//   - disclosure 切换：thinking / 工具组 / 文件树 / 任务面板 / diff 行 / 侧栏分组 / 右栏 section
//   - 前进/可展开指示：submenu 行的"进入下一级"（固定 open=false，永远指右）
//
// 尺寸默认 h-3.5 w-3.5（14px）；个别场景可用 className 覆盖 h-/w-/text-。

interface CaretProps {
  open: boolean;
  /** 额外 class，个别场景微调尺寸（h-/w-）/颜色（text-）/边距。 */
  className?: string;
}

/**
 * 现代 Tailwind disclosure 习惯（shadcn/ui · Headless UI · Radix 同款）：
 * 细描边 chevron-right（Lucide 风格），open 时旋转 90° 朝下，stroke 取 currentColor 继承父色。
 * 比实心 unicode 三角更清爽、矢量缩放永远锐利、hover 跟随变亮。
 */
export function Caret({ open, className = '' }: CaretProps): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
        open ? 'rotate-90' : ''
      } ${className}`}
      style={{ transitionTimingFunction: 'var(--ease-expo)' }}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
