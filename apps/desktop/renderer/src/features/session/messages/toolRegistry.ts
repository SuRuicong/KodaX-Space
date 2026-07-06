// OC-21 ToolRegistry — 把 tool 卡片渲染从 bubbles.tsx 的 if-chain 抽出来
// 改成可注册查表。新 tool 不再要改 bubbles.tsx，自己 register 即可。
//
// 设计：
//   - Renderer 是 pure function 返 `JSX.Element | null`
//     - 返 JSX → 用该 renderer 输出
//     - 返 null → caller (bubbles.tsx) 回退到 raw-JSON / raw-text collapse 视图
//   - 需要 hooks 的 renderer 让返回的 JSX 内嵌一个使用 hooks 的子组件
//   - input / result 分开注册 — tool_start 的 input shape 跟 tool_result 的 result shape 不同；
//     result renderer 多接一个 `input` context 作 read-only 元数据（例如 bash 知道命令是什么）
//
// 现状：input 侧 v0.1.8 接 write/edit/multi_edit；result 侧 v0.1.9 开放 registry 但暂不注册
// 内置（保持现有 JSON dump 行为）。未来可加 bash terminal-style / grep file-list 等专用渲染。

import type { JSX as ReactJSX } from 'react';

// ---- input ----

export interface ToolInputRendererArgs {
  readonly toolName: string;
  readonly input: Record<string, unknown> | undefined;
}

/** Pure function — 返 null 让 caller 回退 raw-JSON collapse 视图。 */
export type ToolInputRenderer = (args: ToolInputRendererArgs) => ReactJSX.Element | null;

const inputRegistry = new Map<string, ToolInputRenderer>();

/** Register an input renderer for a specific tool name. Re-registering overwrites. */
export function registerToolInputRenderer(toolName: string, renderer: ToolInputRenderer): void {
  inputRegistry.set(toolName, renderer);
}

/** Returns null when no renderer registered — caller falls back to raw-JSON view. */
export function getToolInputRenderer(toolName: string): ToolInputRenderer | null {
  return inputRegistry.get(toolName) ?? null;
}

/** Snapshot of registered tool names — for debug / introspection. */
export function listRegisteredToolInputRenderers(): readonly string[] {
  return [...inputRegistry.keys()].sort();
}

/** Test-only: wipe input registry between test cases. */
export function _clearToolInputRegistryForTesting(): void {
  inputRegistry.clear();
}

// ---- result ---- (v0.1.9 OC-21 result side)

export interface ToolResultRendererArgs {
  readonly toolName: string;
  /** SDK 返的 result 文本 (已被 main 端 truncate 到上限) */
  readonly result: string;
  /** tool 启动时的 input record；result renderer 可以拿来获取上下文（例如 bash 命令文本） */
  readonly input?: Record<string, unknown> | undefined;
}

/** Pure function — 返 null 让 caller 回退 raw-text collapse 视图。 */
export type ToolResultRenderer = (args: ToolResultRendererArgs) => ReactJSX.Element | null;

const resultRegistry = new Map<string, ToolResultRenderer>();

/** Register a result renderer for a specific tool name. Re-registering overwrites. */
export function registerToolResultRenderer(toolName: string, renderer: ToolResultRenderer): void {
  resultRegistry.set(toolName, renderer);
}

/** Returns null when no renderer registered — caller falls back to raw-text collapse view. */
export function getToolResultRenderer(toolName: string): ToolResultRenderer | null {
  return resultRegistry.get(toolName) ?? null;
}

/** Snapshot of registered tool names. */
export function listRegisteredToolResultRenderers(): readonly string[] {
  return [...resultRegistry.keys()].sort();
}

/** Test-only: wipe result registry between test cases. */
export function _clearToolResultRegistryForTesting(): void {
  resultRegistry.clear();
}
