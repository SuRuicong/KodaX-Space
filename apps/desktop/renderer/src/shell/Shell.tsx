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

import { useEffect, useRef, useState } from 'react';
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
import { HelpOverlayController } from './HelpOverlay.js';
import { ToastContainer } from './ToastContainer.js';
import { useAppStore } from '../store/appStore.js';

export type Mode = 'coder' | 'partner';

export function Shell(): JSX.Element {
  // Mode：alpha.1 阶段只 Coder 可用，Partner 灰；ADR-004 v2 决策
  const [mode, setMode] = useState<Mode>('coder');

  // 侧栏开/关：button 放在 breadcrumb 行最左 / 最右；侧栏关掉时 0 占位（不再 28px 竖条）
  const leftSidebarOpen = useAppStore((s) => s.leftSidebarOpen);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);
  const setLeftSidebarOpen = useAppStore((s) => s.setLeftSidebarOpen);
  const setRightSidebarOpen = useAppStore((s) => s.setRightSidebarOpen);

  // 右侧栏跟 KodaX 计划列表（todoListBySession）联动：plan 出现 → 自动展开；
  // plan 清空 → 自动折叠。只在 hasPlan 状态切换的瞬间动一次，中间段用户的手动 toggle 不会被打扰。
  // 首次挂载只记录状态、不覆盖 localStorage 持久化值——避免用户上次手动设置被开屏一瞬间冲掉。
  const currentSessionIdForPlan = useAppStore((s) => s.currentSessionId);
  const planLength = useAppStore((s) => {
    const sid = s.currentSessionId;
    return sid ? (s.todoListBySession[sid]?.length ?? 0) : 0;
  });
  const lastAutoHadPlanRef = useRef<boolean | null>(null);
  useEffect(() => {
    const hasPlan = planLength > 0;
    if (lastAutoHadPlanRef.current === null) {
      // 初次：记录但不触发 — 尊重 localStorage 已持久的偏好
      lastAutoHadPlanRef.current = hasPlan;
      return;
    }
    if (lastAutoHadPlanRef.current === hasPlan) return; // 没切换
    setRightSidebarOpen(hasPlan);
    lastAutoHadPlanRef.current = hasPlan;
  }, [planLength, currentSessionIdForPlan, setRightSidebarOpen]);

  // 历史 session 切换时按需从 KodaX SDK 拉持久化对话内容回填 store。
  // events / userMessages buffer 是 in-memory；重启 / 切到 new session 后空 → 调
  // session.history → 拍平 messages 喂回 store，让 ConversationStreamV2 能渲染。
  // 仅当 buffer 真的为空时拉，避免覆盖 in-flight 会话已有 events（reviewer 边界）。
  const restoredSessionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const sid = currentSessionIdForPlan;
    if (!sid || !window.kodaxSpace) return;
    if (restoredSessionsRef.current.has(sid)) return; // 已拉过本会话生命周期
    const state = useAppStore.getState();
    const events = state.eventsBySession[sid] ?? [];
    const userMsgs = state.userMessagesBySession[sid] ?? [];
    if (events.length > 0 || userMsgs.length > 0) {
      restoredSessionsRef.current.add(sid);
      return; // in-flight / 已有数据 → 不打扰
    }
    let cancelled = false;
    void window.kodaxSpace
      .invoke('session.history', { sessionId: sid })
      .then((r) => {
        if (cancelled || !r.ok) return;
        const items = r.data.items;
        if (items.length === 0) {
          restoredSessionsRef.current.add(sid);
          return;
        }
        const store = useAppStore.getState();
        for (const item of items) {
          if (item.kind === 'user') {
            store.appendUserMessage(sid, item.content);
          } else {
            // assistant：合成 text_delta + 可选 thinking_delta + session_complete，
            // 让 composeMessages 的 segment 划分能正确拼出"user 消息 + assistant 回复"对
            if (item.thinking !== undefined && item.thinking.length > 0) {
              store.appendEvent({ kind: 'thinking_delta', sessionId: sid, text: item.thinking });
            }
            if (item.text.length > 0) {
              store.appendEvent({ kind: 'text_delta', sessionId: sid, text: item.text });
            }
            store.appendEvent({ kind: 'session_complete', sessionId: sid });
          }
        }
        restoredSessionsRef.current.add(sid);
      });
    return () => {
      cancelled = true;
    };
  }, [currentSessionIdForPlan]);

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

  // P4a: Ctrl+\ 进入/退出"专注阅读"模式 — 隐藏 Left / Right Sidebar，让主区域满宽。
  //   - BottomBar / Breadcrumb / titlebar 保留（用户仍要发消息 + 窗口操作）
  //   - Esc 退出（如果 Help overlay / 搜索框等都已关）
  const [fullscreenRead, setFullscreenRead] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '\\') {
        e.preventDefault();
        setFullscreenRead((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
        {!fullscreenRead && leftSidebarOpen && <LeftSidebar mode={mode} onModeChange={setMode} />}

        <div className="flex-1 flex flex-col min-w-0 relative">
          <div className="flex items-center px-3 h-10 border-b border-border-default flex-shrink-0 gap-1">
            {/* 左侧栏切换按钮 — 始终常驻，让收起后仍能一键展开 */}
            <SidebarToggleButton
              side="left"
              open={leftSidebarOpen && !fullscreenRead}
              onClick={() => {
                if (fullscreenRead) {
                  setFullscreenRead(false);
                  setLeftSidebarOpen(true);
                } else {
                  setLeftSidebarOpen(!leftSidebarOpen);
                }
              }}
            />
            <Breadcrumb />
            <CommandToolbar active={activePopout} onToggle={setActivePopout} />
            {fullscreenRead && (
              <button
                type="button"
                onClick={() => setFullscreenRead(false)}
                className="ml-1 text-[10px] px-2 py-0.5 rounded border border-border-default text-fg-muted hover:text-fg-primary"
                title="Exit focus mode (Ctrl+\\)"
              >
                ↗ Focus
              </button>
            )}
            {/* 右侧栏切换按钮 */}
            <SidebarToggleButton
              side="right"
              open={rightSidebarOpen && !fullscreenRead}
              onClick={() => {
                if (fullscreenRead) {
                  setFullscreenRead(false);
                  setRightSidebarOpen(true);
                } else {
                  setRightSidebarOpen(!rightSidebarOpen);
                }
              }}
            />
          </div>

          <ConversationStreamV2 />

          <BottomBar />

          {activePopout !== null && (
            <PopoutOverlay kind={activePopout} onClose={() => setActivePopout(null)} />
          )}
        </div>

        {!fullscreenRead && rightSidebarOpen && <RightSidebar />}

        <PermissionModal />
        <AskUserModal />
        <HelpOverlayController />
      </div>
      <ToastContainer />
    </div>
  );
}

interface SidebarToggleButtonProps {
  side: 'left' | 'right';
  open: boolean;
  onClick: () => void;
}

/**
 * 侧栏切换按钮 — 放在 breadcrumb 行的两端，常驻显示。
 * - icon: ◧ (left) / ◨ (right)，对应侧的紧凑指示
 * - open 时图标 text-fg-primary；close 时 text-fg-muted（让用户一眼看出当前状态）
 */
function SidebarToggleButton({ side, open, onClick }: SidebarToggleButtonProps): JSX.Element {
  const icon = side === 'left' ? '◧' : '◨';
  const label = `${open ? 'Hide' : 'Show'} ${side} sidebar`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-6 h-6 rounded text-[12px] flex items-center justify-center flex-shrink-0 hover:bg-hover-bg ${
        open ? 'text-fg-primary' : 'text-fg-muted hover:text-fg-primary'
      }`}
      title={label}
      aria-label={label}
      aria-pressed={open}
    >
      {icon}
    </button>
  );
}
