// OC-21 ToolRegistry — 把 tool 卡片 input 渲染从 bubbles.tsx 的 if-chain 抽出来
// 改成可注册查表。新 tool 不再要改 bubbles.tsx，自己 registerToolInputRenderer 即可。
//
// 设计：
//   - Renderer 是 pure function 返 `JSX.Element | null`
//     - 返 JSX → 用该 renderer 输出
//     - 返 null → caller (bubbles.tsx ToolEditInputView) 回退到 raw-JSON collapse 视图
//   - 需要 hooks 的 renderer (multi_edit) 让返回的 JSX 内嵌一个使用 hooks 的子组件
//   - input/result 分开注册 — tool_start 的 input shape 跟 tool_result 的 result shape 不同
//
// 现状：只接入 input 侧；result 侧 v0.1.8 暂用 JSON dump，留扩展。

export interface ToolInputRendererArgs {
  readonly toolName: string;
  readonly input: Record<string, unknown> | undefined;
}

/** Pure function — 返 null 让 caller 回退 raw-JSON collapse 视图。 */
export type ToolInputRenderer = (args: ToolInputRendererArgs) => JSX.Element | null;

const inputRegistry = new Map<string, ToolInputRenderer>();

/** Register a renderer for a specific tool name. Re-registering overwrites. */
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

/** Test-only: wipe registry between test cases. */
export function _clearToolInputRegistryForTesting(): void {
  inputRegistry.clear();
}
