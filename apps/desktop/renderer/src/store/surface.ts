// F045 — Surface 一等抽象（HLD §9.4 / ADR-007）。
//
// Surface = 同一 KodaX runtime 上的「画像组合」。把 renderer 从隐式单态
// （处处假设 Coder）升级为可在 Coder / Partner 两个 surface 间手动切换的一等状态。
//
// 切换是**渲染层路由**，不重启 main 进程的 KodaX runtime。
//
// 范围边界（本版只做地基）：
//   - ✅ surface 概念 + 手动 tab 切换 + 布局路由。
//   - ⏳ session 分面（Coder/Partner 会话列表彼此独立）：依赖 SDK 给 session 加
//     自定义 tag + listSessions 按 tag 过滤的原生能力（已转交需求）。SDK 到位前
//     不做消费端索引 workaround（生命周期不同步、脆弱）。
//   - ⏳ Partner 受限工具集（F047）/ 自定义画像（F053，依赖 SDK R1/R2）。

import { create } from 'zustand';
import type { Surface } from '@kodax-space/space-ipc-schema';

// F045: Surface 联合的**权威定义**在 IPC schema 包（surfaceSchema = z.enum(['code','partner'])）
// ——renderer 从那里 import 并 re-export，避免两处独立声明 drift（新增面只改 schema 一处）。
export type { Surface };

/** 工具策略：理想态由 SDK 工具能力维度元数据驱动（R3）；交付前按名单裁剪（F047）。 */
export type ToolPolicy = 'all-coding' | 'non-bash-subset';

/** Surface 的静态形态（HLD §9.4 的权威 SurfaceSpec）。 */
export interface SurfaceSpec {
  readonly sessionKind: 'code' | 'partner';
  readonly tools: ToolPolicy;
  readonly layout: 'code-workspace' | 'doc-workspace';
  readonly scope: 'git-root' | 'any-dir';
  readonly artifacts: boolean;
  readonly agentProfile: 'coding-default' | 'partner';
}

export const SURFACES: Record<Surface, SurfaceSpec> = {
  code: {
    sessionKind: 'code',
    tools: 'all-coding',
    layout: 'code-workspace',
    scope: 'git-root',
    artifacts: false,
    agentProfile: 'coding-default',
  },
  partner: {
    sessionKind: 'partner',
    tools: 'non-bash-subset', // read/grep/glob + 富格式 IO + web；默认无 bash（F047）
    layout: 'doc-workspace', // 三栏：Sources | 对话+任务进度 | Artifact 预览（F046）
    scope: 'any-dir',
    artifacts: true,
    agentProfile: 'partner', // 自定义画像走完整 harness 留 F053（依赖 SDK R1/R2）
  },
};

export const DEFAULT_SURFACE: Surface = 'code';

interface SurfaceState {
  /** 当前显示的 surface。默认 Coder，不破坏 v0.1.10 单 surface 行为。 */
  readonly currentSurface: Surface;
  /** 显式切换（tab 点击）。 */
  setSurface: (surface: Surface) => void;
}

export const useSurfaceStore = create<SurfaceState>((set) => ({
  currentSurface: DEFAULT_SURFACE,
  setSurface: (surface) => set({ currentSurface: surface }),
}));

/** spec 取用便捷器（组件里读 layout/tools/scope 用）。 */
export function surfaceSpec(surface: Surface): SurfaceSpec {
  return SURFACES[surface];
}
