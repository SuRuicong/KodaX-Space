// OC-21 Built-in tool input renderers.
//
// 这里 register 三个内置 — write / edit / multi_edit — 用 ToolDiffView 渲染 Monaco diff。
// 旧 bubbles.tsx 的 ToolEditInputView if-chain 抽出来；新 tool 想自定义渲染走
// `registerToolInputRenderer('toolName', renderer)` 即可，不再改 bubbles。
//
// 模块 import 即注册（side effect）— 让 SessionMessages mount 时就生效。
//
// 契约：renderer 是 pure function，返 null = "shape 不对/没法渲染"，调用方回退
// RawJsonInput。需要 hooks 的 renderer (multi_edit) 让返回的 JSX 内嵌使用 hooks
// 的子组件 (MultiEditList)。

import { useState } from 'react';
import { ToolDiffView } from './ToolDiffView.js';
import { registerToolInputRenderer } from './toolRegistry.js';

/** 工具：从 input record 里抽 string 字段（其它类型当成不存在）。 */
function pickString(o: Record<string, unknown> | undefined, key: string): string | null {
  if (!o) return null;
  const v = o[key];
  return typeof v === 'string' ? v : null;
}

// ---- write ----

registerToolInputRenderer('write', ({ input }) => {
  const path = pickString(input, 'file_path') ?? pickString(input, 'path') ?? '';
  const content = pickString(input, 'content');
  if (content === null) return null; // shape 不对 → fallback
  return (
    <section className="space-y-1">
      <div className="text-[11px] text-fg-muted uppercase">write</div>
      <ToolDiffView path={path} before="" after={content} defaultExpanded={false} />
    </section>
  );
});

// ---- edit ----

registerToolInputRenderer('edit', ({ input }) => {
  const path = pickString(input, 'file_path') ?? pickString(input, 'path') ?? '';
  const oldS = pickString(input, 'old_string');
  const newS = pickString(input, 'new_string');
  if (oldS === null || newS === null) return null;
  return (
    <section className="space-y-1">
      <div className="text-[11px] text-fg-muted uppercase">edit</div>
      <ToolDiffView path={path} before={oldS} after={newS} defaultExpanded={false} />
    </section>
  );
});

// ---- multi_edit ----
//
// 需要 useState 控 showAllEdits，把状态放在 sub-component 而不是 renderer 本体，
// 让 renderer 仍是 pure function。

interface MultiEditListProps {
  readonly path: string;
  readonly edits: readonly unknown[];
}

function MultiEditList({ path, edits }: MultiEditListProps): JSX.Element {
  // cap 同屏 Monaco 实例 — 全展开 = N × DiffEditor × ~3MB JS + N × worker
  const MAX_VISIBLE = 5;
  const [showAllEdits, setShowAllEdits] = useState(false);
  const visible = showAllEdits ? edits : edits.slice(0, MAX_VISIBLE);
  const overflow = edits.length - MAX_VISIBLE;
  return (
    <section className="space-y-1.5">
      <div className="text-[11px] text-fg-muted uppercase">
        multi_edit · {edits.length} edit{edits.length === 1 ? '' : 's'}
      </div>
      {visible.map((e, i) => {
        const item = e as Record<string, unknown> | undefined;
        const oldS = pickString(item, 'old_string');
        const newS = pickString(item, 'new_string');
        if (oldS === null || newS === null) {
          return (
            <div
              key={i}
              className="text-[11px] text-fg-muted italic px-2 py-1 border border-dashed border-border-strong/40 rounded"
            >
              Edit #{i + 1}: missing old_string / new_string fields
            </div>
          );
        }
        return (
          <ToolDiffView key={i} path={path} before={oldS} after={newS} defaultExpanded={false} />
        );
      })}
      {!showAllEdits && overflow > 0 && (
        <button
          type="button"
          onClick={() => setShowAllEdits(true)}
          className="text-[11px] text-blue-400 hover:text-blue-300 px-2 py-0.5"
        >
          + {overflow} more edit{overflow === 1 ? '' : 's'}
        </button>
      )}
    </section>
  );
}

registerToolInputRenderer('multi_edit', ({ input }) => {
  const edits = input?.edits;
  if (!Array.isArray(edits) || edits.length === 0) return null;
  const path = pickString(input, 'file_path') ?? pickString(input, 'path') ?? '';
  return <MultiEditList path={path} edits={edits} />;
});
