// ResizeHandle — 2026-06 (v0.1.9).
//
// 1px 视觉宽 / 4px 命中宽的垂直分隔条，拖动调整左右侧栏。
//   side='left'  贴在左侧栏右缘 (border-r 位置)，向右拖 → 加宽
//   side='right' 贴在右侧栏左缘 (border-l 位置)，向左拖 → 加宽
//
// 实现要点:
//   - 拖动期间用 document-level mousemove/mouseup 避免离开 handle 自身后失焦
//   - body.style.cursor='ew-resize' + body.style.userSelect='none' 让整页面同步变指针
//     并禁选,避免拖动时不小心高亮 sidebar 内文字
//   - Esc 取消拖动 (回到 start 宽度)
//   - 双击 reset 到默认 (left=260, right=320 — 跟 store 默认对齐)
//
// 不持久化中间值,只 release (mouseup) 时调一次 setWidth → 写 localStorage。
// 拖动中通过 onPreview 回调让 caller 显示实时宽度,不必每帧 setState 整个 store。

import { useCallback, useEffect, useRef } from 'react';

export interface ResizeHandleProps {
  readonly side: 'left' | 'right';
  /** 当前宽度（px） */
  readonly width: number;
  /** mouseup / blur 时一次性提交最终宽度 */
  readonly onCommit: (px: number) => void;
  /** 默认宽度（双击 reset 用） */
  readonly defaultWidth: number;
  /** 拖动期可选实时回调（caller 用 inline style 直接改父 width，避免 store 抖动） */
  readonly onPreview?: (px: number) => void;
}

export function ResizeHandle({
  side,
  width,
  onCommit,
  defaultWidth,
  onPreview,
}: ResizeHandleProps): JSX.Element {
  // 把"拖动 session"信息塞在一个 ref 里，避免 mousemove handler 闭包过期
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    active: boolean;
  } | null>(null);
  // v0.1.9 release review HIGH-2: 拖动中组件 unmount 时 window 上的 3 个 listener
  // 不会被 onUp / onKey 清掉,造成永久泄漏 + closure 持有过期 props。useEffect
  // cleanup 通过这个 ref 拿到当前 listener 引用统一 detach。
  const listenersRef = useRef<{
    onMove: (e: MouseEvent) => void;
    onUp: (e: MouseEvent) => void;
    onKey: (e: KeyboardEvent) => void;
  } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // 只响应左键
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startWidth: width,
        active: true,
      };
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent): void => {
        const drag = dragRef.current;
        if (!drag || !drag.active) return;
        const dx = ev.clientX - drag.startX;
        // side='left': 鼠标向右走,左侧栏变宽
        // side='right': 鼠标向左走,右侧栏变宽（dx 取反）
        const next = side === 'left' ? drag.startWidth + dx : drag.startWidth - dx;
        onPreview?.(next);
      };

      const detach = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('keydown', onKey);
        listenersRef.current = null;
      };

      const onUp = (ev: MouseEvent): void => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = ev.clientX - drag.startX;
        const next = side === 'left' ? drag.startWidth + dx : drag.startWidth - dx;
        dragRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        detach();
        onCommit(next);
      };

      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key !== 'Escape') return;
        const drag = dragRef.current;
        if (!drag) return;
        // 取消 → 把宽度恢复到拖动起点
        dragRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        detach();
        onPreview?.(drag.startWidth);
        onCommit(drag.startWidth);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('keydown', onKey);
      listenersRef.current = { onMove, onUp, onKey };
    },
    [side, width, onCommit, onPreview],
  );

  const onDoubleClick = useCallback(() => {
    onPreview?.(defaultWidth);
    onCommit(defaultWidth);
  }, [defaultWidth, onCommit, onPreview]);

  // 卸载时清理:
  //   - body cursor / userSelect (极端情况:组件 unmount 时还在拖)
  //   - **window listener** (review HIGH-2): 拖动中 unmount 时 onUp/onKey 永远不会被调用,
  //     listener 永远不会自己 detach。这里兜底 detach,否则 closure 持有过期 props/ref。
  useEffect(() => {
    return () => {
      if (listenersRef.current) {
        window.removeEventListener('mousemove', listenersRef.current.onMove);
        window.removeEventListener('mouseup', listenersRef.current.onUp);
        window.removeEventListener('keydown', listenersRef.current.onKey);
        listenersRef.current = null;
      }
      if (dragRef.current?.active) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        dragRef.current = null;
      }
    };
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize left sidebar' : 'Resize right sidebar'}
      aria-valuenow={width}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={[
        // 4px 宽命中区,中间 1px 实色边线 + hover 强化 — 视觉上跟现有 border 一致
        'flex-shrink-0 w-1 cursor-ew-resize relative select-none',
        'hover:bg-info/30 active:bg-info/50 transition-colors',
        // 拖动时整条变高亮（active 通过 mousedown 让 body cursor 变,实际样式靠 hover 类）
      ].join(' ')}
      title="Drag to resize · Double-click to reset · Esc to cancel"
    />
  );
}
