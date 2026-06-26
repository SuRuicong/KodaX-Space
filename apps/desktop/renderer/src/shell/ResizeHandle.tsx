// ResizeHandle — 2026-06 (v0.1.9; F059c rewrite to Pointer Events).
//
// 1px 视觉宽 / 4px 命中宽的垂直分隔条，拖动调整左右侧栏。
//   side='left'  贴在左侧栏右缘 (border-r 位置)，向右拖 → 加宽
//   side='right' 贴在右侧栏左缘 (border-l 位置)，向左拖 → 加宽
//
// **Pointer capture（关键）**：用 Pointer Events + setPointerCapture，把整段拖动的
// pointermove/up **强制路由到 handle 元素本身**，无论指针移到哪——包括移到 <iframe>
// 上（artifact HTML / preview / terminal / LC sandbox）。这一并解决了用户复报的两个 bug：
//   1) 向窄拖时光标进右栏 artifact iframe → 以前 mousemove 被 iframe 吞 → "卡住"。
//   2) mouseup 落在 iframe 上 / 指针离开窗口 → 以前 mouseup 收不到 → 拖动"没松开"、
//      focus 卡在拖动栏、之后拖不动。
// 捕获后这些事件都还到 handle，drag 一定能正常结束。pointercancel 兜底（系统中断捕获）。
//
// 其它：
//   - body.style.cursor='ew-resize' + userSelect='none' 拖动期全页指针/禁选
//   - Esc 取消拖动（回到 start 宽度）
//   - 双击 reset 到默认（left=260, right=320 — 跟 store 默认对齐）
//   - 只 release 时调一次 onCommit → 写 localStorage；拖动中 onPreview 实时驱动父 width。

import { useCallback, useEffect, useRef } from 'react';

export interface ResizeHandleProps {
  readonly side: 'left' | 'right';
  /** 当前宽度（px） */
  readonly width: number;
  /** pointerup 时一次性提交最终宽度 */
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
  // 拖动 session 信息（startX/startWidth）放 ref，避免 move handler 闭包过期。
  const dragRef = useRef<{ startX: number; startWidth: number; active: boolean } | null>(null);
  // 拖动中 unmount 时，绑在 handle 上的 listener + pointer capture 不会被 onUp 清掉；
  // useEffect cleanup 通过这个 ref 统一 detach（review HIGH-2 的等价处理）。
  const teardownRef = useRef<(() => void) | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // 只响应左键
      e.preventDefault();
      const el = e.currentTarget;
      const pointerId = e.pointerId;
      dragRef.current = { startX: e.clientX, startWidth: width, active: true };
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      const nextFrom = (clientX: number): number => {
        const drag = dragRef.current;
        if (!drag) return width;
        const dx = clientX - drag.startX;
        // side='left': 鼠标向右 → 左栏变宽；side='right': 鼠标向左 → 右栏变宽（dx 取反）
        return side === 'left' ? drag.startWidth + dx : drag.startWidth - dx;
      };

      const onMove = (ev: PointerEvent): void => {
        if (!dragRef.current?.active) return;
        onPreview?.(nextFrom(ev.clientX));
      };

      // teardown 幂等：移除 handle 上的 pointer listeners + window keydown，释放捕获，
      // 复位 body 样式。多次调用安全（onUp / cancel / unmount 都可能触发）。
      const teardown = (): void => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('blur', onWindowBlur);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        try {
          if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
        } catch {
          /* capture 已释放 — 忽略 */
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        dragRef.current = null;
        teardownRef.current = null;
      };

      const onUp = (ev: PointerEvent): void => {
        const px = nextFrom(ev.clientX);
        teardown();
        onCommit(px);
      };

      const onCancel = (): void => {
        const start = dragRef.current?.startWidth ?? width;
        teardown();
        // 系统中断捕获（少见）→ 回到起点宽度，别留半拖状态。
        onPreview?.(start);
        onCommit(start);
      };

      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key !== 'Escape') return;
        const start = dragRef.current?.startWidth ?? width;
        teardown();
        onPreview?.(start);
        onCommit(start);
      };

      const onWindowBlur = (): void => onCancel();

      const onVisibilityChange = (): void => {
        if (document.hidden) onCancel();
      };

      // setPointerCapture：之后 pointermove/up/cancel 都派发到 el，即便指针在 iframe 上。
      try {
        el.setPointerCapture(pointerId);
      } catch {
        /* 极端环境不支持捕获 — 仍绑 el listener，至少 handle 上方可用 */
      }
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey);
      window.addEventListener('blur', onWindowBlur);
      document.addEventListener('visibilitychange', onVisibilityChange);
      teardownRef.current = teardown;
    },
    [side, width, onCommit, onPreview],
  );

  const onDoubleClick = useCallback(() => {
    onPreview?.(defaultWidth);
    onCommit(defaultWidth);
  }, [defaultWidth, onCommit, onPreview]);

  // 拖动中 unmount 兜底：teardown 还挂着就执行它（释放捕获 + 复位 body + 清 listener）。
  useEffect(() => {
    return () => {
      teardownRef.current?.();
    };
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize left sidebar' : 'Resize right sidebar'}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={[
        'flex-shrink-0 w-1 cursor-ew-resize relative select-none touch-none',
        'hover:bg-info/30 active:bg-info/50 transition-colors',
      ].join(' ')}
      title="Drag to resize · Double-click to reset · Esc to cancel"
    />
  );
}
