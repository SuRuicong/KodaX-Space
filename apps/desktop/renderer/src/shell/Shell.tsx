// Shell — F011-revised (alpha.1)
//
// Claude Desktop 风 layout 总入口，替代旧 App.tsx。
//
//   ┌───────────────────────────────────────────────────────────┐
//   │                    顶部空白 (drag region)                  │
//   ├──────┬────────────────────────────────────────────────────┤
//   │ Left │ Breadcrumb (project / session ▾)        CommandBar │
//   │ Side │ ─────────────────────────────────────────────────  │
//   │ bar  │                                                    │
//   │      │           ConversationStream (主区)                 │
//   │      │                                                    │
//   │      │ ─────────────────────────────────────────────────  │
//   │      │ ChipBar (Local · proj · branch)                    │
//   │      │ InputBox                                           │
//   │      │ Footer-row (mode · gateway · model+effort)         │
//   └──────┴────────────────────────────────────────────────────┘
//   ＋ 右上 popout overlay（按需呼出 Preview / Diff / Terminal / Tasks / Plan）
//
// 不在这里做的：
//   - IPC 连接 / store 订阅 → 留在各子组件
//   - popout 业务实现 → 留 popouts/ 子目录
//   - Permission modal / Settings overlay → 复用旧 App 的实现挂载点

import { useEffect, useState } from 'react';
import { LeftSidebar } from './LeftSidebar.js';
import { Breadcrumb } from './Breadcrumb.js';
import { CommandToolbar, type PopoutKind } from './CommandToolbar.js';
import { BottomBar } from './BottomBar.js';
import { ConversationStreamV2 } from './ConversationStreamV2.js';
import { PopoutOverlay } from './popouts/PopoutOverlay.js';
import { PermissionModal } from '../features/permission/PermissionModal.js';
import { AskUserModal } from '../features/ask-user/AskUserModal.js';
import { ThemeToggle } from './ThemeToggle.js';
import { RightSidebar } from './RightSidebar.js';

export type Mode = 'coder' | 'partner';

export function Shell(): JSX.Element {
  // Mode：alpha.1 阶段只 Coder 可用，Partner 灰；ADR-004 v2 决策
  const [mode, setMode] = useState<Mode>('coder');

  // 给 body 加 platform class，让 styles.css 里 .platform-darwin 的 traffic-lights
  // 让位规则生效。navigator.userAgent 在 Electron renderer 中 reliable。
  useEffect(() => {
    const ua = navigator.userAgent;
    let cls = 'platform-other';
    if (/Mac OS X/i.test(ua)) cls = 'platform-darwin';
    else if (/Windows/i.test(ua)) cls = 'platform-win32';
    else if (/Linux/i.test(ua)) cls = 'platform-linux';
    document.body.classList.add(cls);
    return () => document.body.classList.remove(cls);
  }, []);
  // popout：null 表示无 popout，按右上按钮切换
  const [activePopout, setActivePopout] = useState<PopoutKind | null>(null);

  return (
    <div className="h-screen flex flex-col bg-surface text-fg-primary overflow-hidden">
      {/* 顶部自定义 titlebar — 自身做窗口拖动 + 留出 Windows overlay 控件 (close/min/max) 空间。
          Mac 上 traffic lights 占 ~78px (hiddenInset)；Windows 上 OS 把 close/min/max 画在右侧 ~138px (titleBarOverlay)。 */}
      <div className="app-titlebar h-9 flex items-center px-3 border-b border-border-default bg-surface flex-shrink-0 select-none">
        <div className="text-[11px] text-fg-muted font-mono titlebar-brand">
          <span className="text-amber-400" aria-hidden>✱</span>{' '}
          <span>KodaX Space</span>
        </div>
        <div className="flex-1" />
        <ThemeToggle />
      </div>

      <div className="flex flex-1 min-h-0">
        <LeftSidebar mode={mode} onModeChange={setMode} />

        <div className="flex-1 flex flex-col min-w-0 relative">
          <div className="flex items-center px-4 h-10 border-b border-border-default flex-shrink-0">
            <Breadcrumb />
            <CommandToolbar active={activePopout} onToggle={setActivePopout} />
          </div>

          <ConversationStreamV2 />

          <BottomBar />

          {activePopout !== null && (
            <PopoutOverlay kind={activePopout} onClose={() => setActivePopout(null)} />
          )}
        </div>

        <RightSidebar />

        <PermissionModal />
        <AskUserModal />
      </div>
    </div>
  );
}
