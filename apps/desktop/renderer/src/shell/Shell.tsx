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

import { useCallback, useEffect, useRef, useState } from 'react';
import { LeftSidebar } from './LeftSidebar.js';
import { ResizeHandle } from './ResizeHandle.js';
import { useSmartPopoutDirector } from '../features/popout-director/useSmartPopoutDirector.js';
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
import { CommandPaletteController } from './CommandPalette.js';
import { ToastContainer } from './ToastContainer.js';
import { UpdateBanner } from '../features/updater/UpdateBanner.js';
import { useAppStore } from '../store/appStore.js';

export type Mode = 'coder' | 'partner';

// 模块级 set：哪些 session 已从 SDK 拉过 history 回填 store。
// 之前用 useRef 在 Shell component 里——HMR 重挂 / Shell 卸载重挂都会丢，导致 fork/rewind
// 后 component 重新 mount 时又跑一次 session.history IPC（缓存现在帮忙省 jsonl 读，但
// store 复写 events 是真实成本）。挪到 module 级 process 级共享，跨 HMR 仍保留。
const restoredSessionIds = new Set<string>();

export function Shell(): JSX.Element {
  // Mode：alpha.1 阶段只 Coder 可用，Partner 灰；ADR-004 v2 决策
  const [mode, setMode] = useState<Mode>('coder');

  // 侧栏开/关：button 放在 breadcrumb 行最左 / 最右；侧栏关掉时 0 占位（不再 28px 竖条）
  const leftSidebarOpen = useAppStore((s) => s.leftSidebarOpen);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);
  const setLeftSidebarOpen = useAppStore((s) => s.setLeftSidebarOpen);
  const setRightSidebarOpen = useAppStore((s) => s.setRightSidebarOpen);

  // 2026-06: 侧栏宽度。store 是 commit-only (release 时一次性写),drag 中间用本地 state
  // 实时驱动 inline width style 避免 store 抖动 / localStorage 频繁写。
  const persistedLeftWidth = useAppStore((s) => s.leftSidebarWidth);
  const persistedRightWidth = useAppStore((s) => s.rightSidebarWidth);
  const setLeftSidebarWidth = useAppStore((s) => s.setLeftSidebarWidth);
  const setRightSidebarWidth = useAppStore((s) => s.setRightSidebarWidth);
  const [leftWidthDraft, setLeftWidthDraft] = useState<number | null>(null);
  const [rightWidthDraft, setRightWidthDraft] = useState<number | null>(null);
  const leftWidth = leftWidthDraft ?? persistedLeftWidth;
  const rightWidth = rightWidthDraft ?? persistedRightWidth;

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
  // 模块级 restoredSessionIds 跨 HMR / Shell remount 保留——见文件顶部。
  //
  // **race condition 修复 (2026-05)**：用 prependSessionHistory 原子前置 historical，
  // 避免 IPC 等待期用户已经发了新消息时旧逻辑(逐条 appendUserMessage)把 user array
  // 顺序打乱(新消息 Q3 跑到 historical U1/U2 前面 → composeMessages 按 index 配对全错位)。
  // 现在哪怕 race 发生,前置后变 [hist..., new]; 顺序与 composeMessages 一致。
  useEffect(() => {
    const sid = currentSessionIdForPlan;
    if (!sid || !window.kodaxSpace) return;
    if (restoredSessionIds.has(sid)) return; // 已拉过
    // 注意:不再在 IPC 调用前 short-circuit "buffer 非空"——那是旧版兜底,现在 prepend
    // 是原子的,即使 buffer 已经有 in-flight 会话也能正确插入历史在前面。
    let cancelled = false;
    void window.kodaxSpace
      .invoke('session.history', { sessionId: sid })
      .then((r) => {
        if (cancelled || !r.ok) return;
        const items = r.data.items;
        if (items.length === 0) {
          restoredSessionIds.add(sid);
          return;
        }
        const store = useAppStore.getState();
        // history fallback timestamp：用 session.createdAt（SDK 落盘时刻），让 footer
        // 显示 "Xd ago" 反映 session 创建时间而不是"恢复瞬间 just now"。SDK 未来给
        // per-message timestamp 时再走 item.sentAt。
        const sess = store.sessions.find((s) => s.sessionId === sid);
        const fallbackTs = sess?.createdAt ?? Date.now();
        store.prependSessionHistory(sid, items, fallbackTs);
        restoredSessionIds.add(sid);
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
  const [activePopout, setActivePopoutRaw] = useState<PopoutKind | null>(null);

  // KX-I-02: 用户手动切 popout (CommandToolbar / RightSidebar ⤢ / slash command) 时,
  // **顺手**把该 (session, kind) 标 promoted —— 让 director 不会下一秒再"自动"打开同一个
  // 把用户刚关掉的 popout (尤其当用户 close 了 director 自动开的那个时,promoted 已经在
  // 了;但用户在 director 之前手动开 plan 时,我们也需要 mark 防止再自动 emit。)
  const currentSessionIdForPopout = useAppStore((s) => s.currentSessionId);
  const markPopoutPromoted = useAppStore((s) => s.markPopoutPromoted);
  const setActivePopout = useCallback(
    (next: PopoutKind | null) => {
      if (currentSessionIdForPopout !== null && next !== null) {
        markPopoutPromoted(currentSessionIdForPopout, next);
      }
      setActivePopoutRaw(next);
    },
    [currentSessionIdForPopout, markPopoutPromoted],
  );

  // KX-I-02: director — 监听 events,首次出现 plan/diff/tasks 信号时 auto setActivePopout
  // (前提:activePopout === null 且该 kind 在本 session 未 promoted 过)。
  useSmartPopoutDirector({ activePopout, setActivePopout });

  // BottomBar 发出的"打开 popout"请求消费 — /memory → 'agents' 等。
  // 拿到 non-null 后立即 setActivePopout + 清回 null,避免被反复消费。
  //
  // **load-bearing**: 同步把 store 的 requestedPopout 重置成 null 会触发本 useEffect 再跑一次,
  // 但 if(requestedPopout === null) return 守门 + zustand "set same value 不通知 subscriber"
  // 双重短路,不会进 setActivePopout 的反复循环。如果未来 zustand 升级 / 添加 immer 等中间件
  // 改变 set 比较语义,这条 guard 必须保留。
  const requestedPopout = useAppStore((s) => s.requestedPopout);
  const setRequestedPopout = useAppStore((s) => s.requestPopout);
  useEffect(() => {
    if (requestedPopout === null) return;
    const known = ['preview', 'diff', 'terminal', 'tasks', 'plan', 'agents', 'mcp'] as const;
    if ((known as readonly string[]).includes(requestedPopout)) {
      setActivePopout(requestedPopout as PopoutKind);
    }
    setRequestedPopout(null); // 消费完清回 null,允许下次 slash command 再次触发
  }, [requestedPopout, setRequestedPopout]);

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
        {!fullscreenRead && leftSidebarOpen && (
          <>
            <LeftSidebar mode={mode} onModeChange={setMode} width={leftWidth} />
            <ResizeHandle
              side="left"
              width={leftWidth}
              defaultWidth={260}
              onPreview={setLeftWidthDraft}
              onCommit={(px) => {
                setLeftWidthDraft(null);
                setLeftSidebarWidth(px);
              }}
            />
          </>
        )}

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

        {!fullscreenRead && rightSidebarOpen && (
          <>
            <ResizeHandle
              side="right"
              width={rightWidth}
              defaultWidth={320}
              onPreview={setRightWidthDraft}
              onCommit={(px) => {
                setRightWidthDraft(null);
                setRightSidebarWidth(px);
              }}
            />
            <RightSidebar width={rightWidth} />
          </>
        )}

        <PermissionModal />
        <AskUserModal />
        <HelpOverlayController />
        <CommandPaletteController />
      </div>
      <ToastContainer />
      <UpdateBanner />
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
