// Portal — 把浮层渲染到 document.body，逃出祖先的 backdrop-filter 包含块 + overflow 裁切。
//
// 背景：CSS 规范里，祖先一旦有 backdrop-filter / transform / filter，就会成为后代
// `position: fixed` 的包含块；再叠加 overflow-hidden 会把溢出的子元素裁掉。
// 右键菜单等用视口坐标定位的浮层若就地渲染在 .glass 侧栏内，会被错位 + 裁切
// （见 SessionContextMenu / ProjectContextMenu）。统一经此 Portal 渲染到 body 根除。

import { createPortal } from 'react-dom';
import type { ReactNode, ReactPortal } from 'react';

interface PortalProps {
  readonly children: ReactNode;
}

/** 把 children 渲染到 document.body。SSR / 无 document 时退化为不渲染（Electron 渲染进程始终有 document）。*/
export function Portal({ children }: PortalProps): ReactPortal | null {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
