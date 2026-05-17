// File tree (lazy load + expand/collapse) — F009.
//
// 渲染递归 FileNode 树。dir 展开时按需 invoke files.tree(subPath) 拉子节点 cache 在 local state，
// 不放 zustand——树状态只在 FilePanel 内消费。点击 file 通过 onSelect 回调上抛。
//
// 性能要点：
//   - 渲染 5k 节点用普通 DOM 就够；超过再考虑虚拟化（v0.1.0 暂不引 react-window）
//   - 展开状态用 Set<path> 跟踪——避免在 node 上加 mutable expanded 字段

import { useEffect, useState } from 'react';
import type { FileNodeT } from '@kodax-space/space-ipc-schema';

interface FileTreeProps {
  projectRoot: string;
  /** 当前选中文件——高亮显示 */
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function FileTree({ projectRoot, selectedPath, onSelect }: FileTreeProps): JSX.Element {
  const [rootNodes, setRootNodes] = useState<readonly FileNodeT[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 缓存已加载的子树：path → children
  const [childrenCache, setChildrenCache] = useState<Record<string, readonly FileNodeT[]>>({});

  // 项目根变了：重新拉树
  useEffect(() => {
    if (!projectRoot) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setRootNodes([]);
    setExpanded(new Set());
    setChildrenCache({});

    const bridge = window.kodaxSpace;
    if (!bridge) {
      setErr('IPC bridge unavailable');
      setLoading(false);
      return;
    }
    bridge
      .invoke('files.tree', { projectRoot, depth: 1 })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setRootNodes(result.data.tree);
          setTruncated(result.data.truncated);
        } else {
          setErr(`${result.error.code}: ${result.error.message}`);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  async function toggleDir(path: string): Promise<void> {
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
      setExpanded(next);
      return;
    }
    next.add(path);
    setExpanded(next);

    // 已 cache 过就不重拉
    if (childrenCache[path]) return;
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    const result = await bridge.invoke('files.tree', {
      projectRoot,
      subPath: path,
      depth: 1,
    });
    if (result.ok) {
      setChildrenCache((c) => ({ ...c, [path]: result.data.tree }));
    }
  }

  if (loading) {
    return <div className="text-xs text-zinc-500 p-3">loading tree…</div>;
  }
  if (err) {
    return <div className="text-xs text-red-400 p-3 font-mono">{err}</div>;
  }
  if (rootNodes.length === 0) {
    return <div className="text-xs text-zinc-600 p-3">empty project</div>;
  }
  return (
    <div className="text-[12px] font-mono select-none">
      {truncated && (
        <div className="text-[10px] text-amber-500 px-2 py-1 border-b border-zinc-800">
          tree truncated (&gt;5000 nodes)
        </div>
      )}
      <FileTreeLevel
        nodes={rootNodes}
        depth={0}
        expanded={expanded}
        childrenCache={childrenCache}
        selectedPath={selectedPath}
        onToggle={(p) => void toggleDir(p)}
        onSelect={onSelect}
      />
    </div>
  );
}

interface FileTreeLevelProps {
  nodes: readonly FileNodeT[];
  depth: number;
  expanded: Set<string>;
  childrenCache: Record<string, readonly FileNodeT[]>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

function FileTreeLevel({
  nodes,
  depth,
  expanded,
  childrenCache,
  selectedPath,
  onToggle,
  onSelect,
}: FileTreeLevelProps): JSX.Element {
  return (
    <ul>
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={depth}
          expanded={expanded}
          childrenCache={childrenCache}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

interface FileTreeNodeProps {
  node: FileNodeT;
  depth: number;
  expanded: Set<string>;
  childrenCache: Record<string, readonly FileNodeT[]>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

function FileTreeNode({
  node,
  depth,
  expanded,
  childrenCache,
  selectedPath,
  onToggle,
  onSelect,
}: FileTreeNodeProps): JSX.Element {
  const isDir = node.kind === 'dir';
  const isExpanded = isDir && expanded.has(node.path);
  // dir 子节点优先用 cache（lazy load 后的）；否则用 node.children（initial depth=1 时为空）
  const dirChildren = isDir ? childrenCache[node.path] ?? node.children ?? [] : [];
  const isSelected = !isDir && node.path === selectedPath;
  const padLeft = depth * 12 + 6;

  return (
    <li>
      <button
        type="button"
        onClick={() => (isDir ? onToggle(node.path) : onSelect(node.path))}
        className={`w-full text-left flex items-center gap-1 px-1 py-0.5 hover:bg-zinc-900 ${
          isSelected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
        }`}
        style={{ paddingLeft: padLeft }}
        title={node.path}
      >
        <span className="w-3 text-zinc-600 text-[10px] inline-block" aria-hidden>
          {isDir ? (isExpanded ? '▾' : '▸') : ''}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && isExpanded && dirChildren.length > 0 && (
        <FileTreeLevel
          nodes={dirChildren}
          depth={depth + 1}
          expanded={expanded}
          childrenCache={childrenCache}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      )}
    </li>
  );
}
