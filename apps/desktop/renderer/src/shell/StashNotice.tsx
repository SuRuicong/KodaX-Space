// StashNotice — KodaX REPL TUI 同款 "工作区脏" 提示 (v0.1.x)
//
// 当前 project 是 git repo 且有未提交改动时,在 BottomBar 上方显示一条非阻塞提示:
//   "● Uncommitted: 3 modified · 1 staged · 2 untracked on main"
//
// 目的: 用户在 dirty 仓库里启动 KodaX task 时心里有数 — KodaX 可能 edit/write 会
//       叠加到现有未提交改动上,review diff 时混在一起。提示用户考虑先 commit / stash。
//
// 数据流:
//   - App 启动 + currentProject 变化 → 调一次 project.gitStatus
//   - tool_result (write/edit/bash) 到达 → debounce 800ms 后再调一次刷新
//     (避免 KodaX 一次连写 20 文件触发 20 次 IPC)
//   - main 端 5s TTL cache 防 hammer git binary
//
// 暂不做 (后续可加):
//   - "Stash" / "Commit" / "Discard" 一键按钮 — 需要 git 操作 IPC + 安全 review
//   - 文件路径列表 — 隐私 + UI 噪音

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore.js';

interface GitStatus {
  readonly isGitRepo: boolean;
  readonly dirty: boolean;
  readonly modifiedCount: number;
  readonly stagedCount: number;
  readonly untrackedCount: number;
  readonly branch: string | null;
  readonly ahead?: number;
  readonly behind?: number;
}

// 模块级 store-by-projectPath: 不放进 zustand 因为只有这个组件用,放本地 ref + state 就够
const REFRESH_DEBOUNCE_MS = 800;

export function StashNotice(): JSX.Element | null {
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  // 监听 events flow 的 tool_result write/edit/bash → 触发 refetch
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const lastToolResultMarker = useAppStore((s) => {
    if (!currentSessionId) return 0;
    const evs = s.eventsBySession[currentSessionId] ?? [];
    // 倒扫找最近一个 write/edit/bash/multiedit 类 tool_result (那才可能改文件树)。
    // 非 write 类 tool (grep / read) 跳过,**继续**扫,直到撞 session_start (turn 起点)
    // 或数组头才退出。原版用 return 0 在第一个非 write tool_result 处即停止,导致
    // 之前发生的 write 永远拿不到 refetch 触发 (审查 H2)。
    for (let i = evs.length - 1; i >= 0; i--) {
      const ev = evs[i];
      if (ev.kind === 'session_start') return 0; // 这一 turn 没有 write 过
      if (ev.kind !== 'tool_result') continue;
      const name = (ev as { toolName?: string }).toolName;
      if (name === 'write' || name === 'edit' || name === 'bash' || name === 'multiedit') {
        return i; // 索引变化即 refetch trigger
      }
      // 非 write 类 → 继续往前找,不 return 0
    }
    return 0;
  });

  const [status, setStatus] = useState<GitStatus | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<boolean>(false);

  // 通用 fetch 函数 — useCallback 让两个 useEffect deps 拿到稳定引用,
  // 避免每 render 新建 closure 导致 effect 看不见正确版本 (审查 M2)。
  const fetchStatus = useCallback((path: string): void => {
    if (!window.kodaxSpace) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    void window.kodaxSpace
      .invoke('project.gitStatus', { projectRoot: path })
      .then((r) => {
        if (!r.ok) return;
        // 只在请求时仍然是同一个 project 时更新 (用户可能已经切走)
        if (useAppStore.getState().currentProjectPath !== path) return;
        setStatus(r.data);
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, []);

  // 初始 / 切 project 时立即拉
  useEffect(() => {
    if (!currentProjectPath) {
      setStatus(null);
      return;
    }
    fetchStatus(currentProjectPath);
  }, [currentProjectPath, fetchStatus]);

  // tool_result 触发 debounced 重读
  useEffect(() => {
    if (!currentProjectPath || lastToolResultMarker === 0) return;
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchStatus(currentProjectPath);
    }, REFRESH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [lastToolResultMarker, currentProjectPath, fetchStatus]);

  if (!status || !status.isGitRepo || !status.dirty) return null;

  // 组装显示文本: "● Uncommitted: 3 modified · 1 staged · 2 untracked on main"
  const parts: string[] = [];
  if (status.modifiedCount > 0) parts.push(`${status.modifiedCount} modified`);
  if (status.stagedCount > 0) parts.push(`${status.stagedCount} staged`);
  if (status.untrackedCount > 0) parts.push(`${status.untrackedCount} untracked`);
  const summary = parts.join(' · ');

  return (
    <div
      className={[
        'px-3 py-1 text-[11px] flex items-center gap-2 border-t border-b',
        // Dark (默认主题): 暖橙文字 + 暗琥珀衬底
        'dark:text-amber-300/90 dark:bg-amber-900/15 dark:border-amber-900/30',
        // Light: 深琥珀文字 (>7:1 对比度) + 浅暖米衬底 + 中性暖边
        'text-amber-800 bg-amber-100/70 border-amber-300',
      ].join(' ')}
      role="status"
      aria-label="Working tree has uncommitted changes"
    >
      <span aria-hidden>●</span>
      <span>Uncommitted: {summary}</span>
      {status.branch && (
        <span className="text-amber-700/80 dark:text-amber-300/60">on {status.branch}</span>
      )}
    </div>
  );
}
