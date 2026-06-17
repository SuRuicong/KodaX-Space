// motion.ts — F068 对话流全量交互动画系统的单一配置源。
//
// 所有动画节奏集中于此：改这里 = 全局调参。styles.css :root 里镜像同名 CSS 变量
// (--motion-* / --ease-*)，keyframe / 工具类引用变量而非魔数。组件只 import 常量 /
// 用 CSS 变量，不内联动画魔数。
//
// 设计依据：huashu-design animation-best-practices §2 —— expoOut 给数字元素「物理重量感」，
// overshoot 用于 toggle / 弹出，30ms stagger（对话流稍密用 24ms 避免长列表拖尾）。
// 门控复用 F060 视觉质量三档：极简档 (q-minimal) 退化为瞬切；prefers-reduced-motion 禁用。

import { useEffect, useState } from 'react';

/** 主 easing（入场 / 面板 / focus）—— expoOut：迅速启动缓慢刹车，给数字元素物理重量感。
 *  huashu-design animation-best-practices §2：cubic-bezier(0.16, 1, 0.3, 1) */
export const EASE_EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** 弹性 easing（toggle / 按钮弹出 / 强调交互）—— overshoot。
 *  cubic-bezier(0.34, 1.56, 0.64, 1) */
export const EASE_OVERSHOOT = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
/** 物理 easing（几何体归位 / 自然落位）—— spring 近似。
 *  cubic-bezier(0.34, 1.3, 0.64, 1)（弱化 overshoot 避免文字抖） */
export const EASE_SPRING = 'cubic-bezier(0.34, 1.3, 0.64, 1)';

/** 时长档（ms）—— 三档覆盖全场景，避免每个动画各写一个魔数。
 *  - fast:   微反馈（caret 旋转、copy 脉冲、ring 出现）
 *  - normal: 主力（消息入场、marker pop、状态 crossfade）
 *  - slow:   大面板（cluster / thinking 折叠展开） */
export const DURATION = {
  fast: 150,
  normal: 260,
  slow: 380,
} as const;

/** stagger 间距（ms）—— 列表入场相邻元素延迟。
 *  huashu-design §4.3：30ms stagger；对话流稍密用 24ms 避免长列表拖尾。 */
export const STAGGER_MS = 24;
/** stagger 封顶数 —— 超过 N 条后不再累加延迟（避免 50 条历史回填时最后一条等 1.2s）。 */
export const STAGGER_CAP = 8;

/** 这些常量在 styles.css :root 里镜像成 CSS 变量，keyframe / 工具类引用变量而非魔数。
 *  运行时若需在 inline style 里引用同名 CSS var（如 Collapse 的 transition），用这个映射。 */
export const MOTION_CSS_VARS = {
  easeExpo: '--ease-expo',
  easeOvershoot: '--ease-overshoot',
  easeSpring: '--ease-spring',
  durationFast: '--motion-fast',
  durationNormal: '--motion-normal',
  durationSlow: '--motion-slow',
} as const;

/** 给某个元素 inline 注入全部 motion CSS 变量（罕见场景：shadow DOM / iframe 等读不到
 *  styles.css :root 变量的隔离上下文）。正常情况下 styles.css 已定义，无需调用。 */
export function motionVars(): Record<string, string> {
  return {
    [MOTION_CSS_VARS.easeExpo]: EASE_EXPO,
    [MOTION_CSS_VARS.easeOvershoot]: EASE_OVERSHOOT,
    [MOTION_CSS_VARS.easeSpring]: EASE_SPRING,
    [MOTION_CSS_VARS.durationFast]: `${DURATION.fast}ms`,
    [MOTION_CSS_VARS.durationNormal]: `${DURATION.normal}ms`,
    [MOTION_CSS_VARS.durationSlow]: `${DURATION.slow}ms`,
  };
}

/**
 * 订阅 `prefers-reduced-motion` 媒体查询。返回 true 时调用方应禁用动画（瞬切）。
 *
 * 服务端渲染 (SSR) 安全：首次 render 时 matchMedia 不存在 → 返回 false，挂载后 effect 纠正。
 * Electron renderer 始终有 window.matchMedia，但 hook 写成 SSR 安全以防测试环境复用。
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}
