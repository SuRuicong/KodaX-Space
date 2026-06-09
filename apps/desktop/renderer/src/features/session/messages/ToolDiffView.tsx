// ToolDiffView — F021 / v0.1.4 C3
//
// Edit / Write / MultiEdit 工具卡里的 diff 视图。对齐 VSCode Claude Code：
//   - 默认折叠，仅显示一行 header：`▶ <basename>  +N / -M`
//   - 点击展开：嵌入 Monaco DiffEditor (split view)，固定 maxHeight + 内部滚动
//
// 性能考量：Monaco editor 实例 ~3MB，懒挂载——只有用户展开时才 mount
// （collapsed 状态下整个 DiffEditor JSX 不出现）。多 ToolCallCard 同屏时
// 默认全部 collapsed 不烧资源。

import { useMemo, useState, lazy, Suspense } from 'react';
import { Caret } from '../../../components/Caret.js';

// 仅在展开时才动态加载 Monaco（Suspense fallback 给出"loading diff"提示）。
// MonacoDiffViewer 本身 import @monaco-editor/react + 完整 monaco-editor，
// 默认 collapsed 时这一坨代码不进 main bundle 关键路径。
const MonacoDiffViewer = lazy(() =>
  import('../../code/MonacoDiffViewer.js').then((m) => ({ default: m.MonacoDiffViewer })),
);

export interface ToolDiffViewProps {
  /** 文件相对/绝对路径 —— 用来推断语言 + 显示 basename */
  path: string;
  /** 改前内容；Write tool 上没有旧内容时传 '' */
  before: string;
  /** 改后内容 */
  after: string;
  /** 默认折叠/展开。Edit 通常默认折叠，单 hunk 可以默认展开 */
  defaultExpanded?: boolean;
}

/**
 * 计算 +N/-M 摘要。简单按行 diff（行级，不做字符级）：
 *   - before 里有 / after 里没 → -1
 *   - after 里有 / before 里没 → +1
 *   - 两边都有但顺序变 → 仍按"出现次数 delta"算
 *
 * 这只是 header 摘要，不是真 diff 算法。Monaco DiffEditor 用的是自己的 diff 算法
 * 渲染 hunk，不依赖这里的数字。
 */
function summarizeChange(before: string, after: string): { plus: number; minus: number } {
  const beforeLines = before === '' ? [] : before.split('\n');
  const afterLines = after === '' ? [] : after.split('\n');
  const counter = new Map<string, number>();
  for (const l of beforeLines) counter.set(l, (counter.get(l) ?? 0) + 1);
  for (const l of afterLines) counter.set(l, (counter.get(l) ?? 0) - 1);
  let minus = 0;
  let plus = 0;
  for (const v of counter.values()) {
    if (v > 0) minus += v;
    else if (v < 0) plus += -v;
  }
  return { plus, minus };
}

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function ToolDiffView(props: ToolDiffViewProps): JSX.Element {
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false);
  const summary = useMemo(
    () => summarizeChange(props.before, props.after),
    [props.before, props.after],
  );
  const name = basenameOf(props.path);

  return (
    <div className="rounded border border-border-default overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={[
          'w-full px-2.5 py-1.5 flex items-center gap-2 text-left text-xs font-mono',
          'dark:bg-surface-2/50 dark:hover:bg-hover-bg bg-surface hover:bg-hover-bg',
          'text-fg-secondary',
        ].join(' ')}
        aria-expanded={expanded}
      >
        <Caret open={expanded} />
        <span className="truncate flex-1" title={props.path}>
          {name}
        </span>
        {summary.plus > 0 && <span className="text-ok font-semibold">+{summary.plus}</span>}
        {summary.minus > 0 && <span className="text-danger font-semibold">−{summary.minus}</span>}
        {/* review C3-HIGH-2: 多集合 diff 算出 0/0 但 before !== after 是"行只是被
            重排了" —— 说 "no change" 会误导用户（Monaco 展开后会显示真实 diff）。
            用 ~reordered 跟"真没改"区分。 */}
        {summary.plus === 0 && summary.minus === 0 && props.before !== props.after && (
          <span className="text-fg-muted">~reordered</span>
        )}
        {summary.plus === 0 && summary.minus === 0 && props.before === props.after && (
          <span className="text-fg-muted">no change</span>
        )}
      </button>
      {expanded && (
        // 固定 maxHeight，内部滚动；DiffEditor height=100% 撑满父容器
        // Monaco 内部 horizontal scroll 也自带，长行不会撑爆 layout
        <div className="dark:bg-[#09090b] bg-white" style={{ height: '50vh', maxHeight: 480 }}>
          <Suspense fallback={<div className="text-xs text-fg-muted p-2">loading diff…</div>}>
            <MonacoDiffViewer path={props.path} before={props.before} after={props.after} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
