// Shared UI primitives.
//
// FEATURE_001 阶段只导一个 cn 工具，证明 workspace 依赖链通。
// FEATURE_006 起，shadcn-style Button / Card / Dialog 等会落到这里。

/**
 * Concatenate class names, filtering falsy. shadcn 风格里通常配 clsx + tailwind-merge，
 * 这里先用最小实现，避免 v0.1.0 引入额外 dep。
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
