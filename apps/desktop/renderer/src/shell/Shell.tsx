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

import { useState } from 'react';
import { LeftSidebar } from './LeftSidebar.js';
import { Breadcrumb } from './Breadcrumb.js';
import { CommandToolbar, type PopoutKind } from './CommandToolbar.js';
import { BottomBar } from './BottomBar.js';
import { ConversationStreamV2 } from './ConversationStreamV2.js';
import { PopoutOverlay } from './popouts/PopoutOverlay.js';
import { PermissionModal } from '../features/permission/PermissionModal.js';

export type Mode = 'coder' | 'partner';

export function Shell(): JSX.Element {
  // Mode：alpha.1 阶段只 Coder 可用，Partner 灰；ADR-004 v2 决策
  const [mode, setMode] = useState<Mode>('coder');
  // popout：null 表示无 popout，按右上按钮切换
  const [activePopout, setActivePopout] = useState<PopoutKind | null>(null);

  return (
    <div className="h-screen flex bg-zinc-950 text-zinc-100 overflow-hidden">
      <LeftSidebar mode={mode} onModeChange={setMode} />

      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="flex items-center px-4 h-10 border-b border-zinc-900 flex-shrink-0">
          <Breadcrumb />
          <CommandToolbar active={activePopout} onToggle={setActivePopout} />
        </div>

        <ConversationStreamV2 />

        <BottomBar />

        {activePopout !== null && (
          <PopoutOverlay kind={activePopout} onClose={() => setActivePopout(null)} />
        )}
      </div>

      <PermissionModal />
    </div>
  );
}
