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
import { Info, PanelLeft, PanelRight } from 'lucide-react';
import type { SpaceCapabilityStatus, SpaceVersionOutput } from '@kodax-space/space-ipc-schema';
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
import { VisualQualityToggle } from './VisualQualityToggle.js';
import { GlassAurora } from './GlassAurora.js';
import { useSpotlight } from '../lib/useSpotlight.js';
import { RightSidebar } from './RightSidebar.js';
import { HelpOverlayController } from './HelpOverlay.js';
import { CommandPaletteController } from './CommandPalette.js';
import { ToastContainer } from './ToastContainer.js';
import { ZoomController } from './ZoomController.js';
import { UpdateBanner } from '../features/updater/UpdateBanner.js';
import { useAppStore, clampSidebarWidthPx } from '../store/appStore.js';
import { useSurfaceStore } from '../store/surface.js';
import { PartnerWorkspace } from '../features/partner/PartnerWorkspace.js';
import { HandoffInbox } from './HandoffInbox.js';

interface ShellProps {
  readonly version?: SpaceVersionOutput | null;
}

// 模块级 set：哪些 session 已从 SDK 拉过 history 回填 store。
// 之前用 useRef 在 Shell component 里——HMR 重挂 / Shell 卸载重挂都会丢，导致 fork/rewind
// 后 component 重新 mount 时又跑一次 session.history IPC（缓存现在帮忙省 jsonl 读，但
// store 复写 events 是真实成本）。挪到 module 级 process 级共享，跨 HMR 仍保留。
const restoredSessionIds = new Set<string>();

export function Shell({ version = null }: ShellProps): JSX.Element {
  // F045: surface 一等状态（替代旧 local mode）。Partner 自本版起有真实空壳。
  const currentSurface = useSurfaceStore((s) => s.currentSurface);

  // F060: Liquid Glass 光标 specular 高光（balanced/full 档；纯 CSS 变量，pointer-events:none 不挡点击）。
  useSpotlight();

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
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
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

  // F059c: 对话里点 artifact 卡片 → 若右侧栏关着先打开它（RightSidebar 内部再切到 Artifact
  // tab + 选中）。否则点了卡片"什么都没发生"。
  useEffect(() => {
    const onFocus = (): void => setRightSidebarOpen(true);
    window.addEventListener('kodax-space.focus-artifact', onFocus);
    return () => window.removeEventListener('kodax-space.focus-artifact', onFocus);
  }, [setRightSidebarOpen]);

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
    void window.kodaxSpace.invoke('session.history', { sessionId: sid }).then((r) => {
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
  // popout：null 表示无 popout，按右上按钮切换。
  // v0.1.9 fix: 同步到 store activePopoutKind,让 RightSidebar Section 的 ⤢ 按钮能判断
  // 当前是否已激活 → 实现 "再点关闭" toggle 行为 (用户反馈 ⤢ 应当 toggle 不是 one-way)。
  const [activePopout, setActivePopoutRaw] = useState<PopoutKind | null>(null);
  const setActivePopoutKindInStore = useAppStore((s) => s.setActivePopoutKind);
  const activePopoutKindFromStore = useAppStore((s) => s.activePopoutKind);
  useEffect(() => {
    setActivePopoutKindInStore(activePopout);
  }, [activePopout, setActivePopoutKindInStore]);
  // 双向同步: 其它组件 (RightSidebar Section ⤢) setActivePopoutKind(null) → 关 popout。
  // 守门: 仅当 store 跟本地 state 不一致时切,避免上面那个 effect 写 store 后立刻被读回触发再 set。
  useEffect(() => {
    if (activePopoutKindFromStore !== activePopout) {
      setActivePopoutRaw(activePopoutKindFromStore as PopoutKind | null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePopoutKindFromStore]);

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
    // F046 review HIGH-3: Partner 面不挂 PopoutOverlay。若在 Partner 触发 requestPopout
    // （如某条 slash command），这里仍会 setActivePopout 但无 overlay 渲染 → 请求被静默吞掉、
    // 切回 Coder 也不会重放。Partner 下直接丢弃请求（清 null），不污染 activePopout。
    if (currentSurface !== 'code') {
      setRequestedPopout(null);
      return;
    }
    const known = [
      'preview',
      'diff',
      'terminal',
      'tasks',
      'plan',
      'agents',
      'mcp',
      'artifact',
      'workflow',
    ] as const;
    if ((known as readonly string[]).includes(requestedPopout)) {
      setActivePopout(requestedPopout as PopoutKind);
    }
    setRequestedPopout(null); // 消费完清回 null,允许下次 slash command 再次触发
  }, [requestedPopout, setRequestedPopout, setActivePopout, currentSurface]);

  // P4a: Ctrl+\ 进入/退出"专注阅读"模式 — 隐藏 Left / Right Sidebar，让主区域满宽。
  //   - BottomBar / Breadcrumb / titlebar 保留（用户仍要发消息 + 窗口操作）
  //   - Esc 退出（如果 Help overlay / 搜索框等都已关）
  const [fullscreenRead, setFullscreenRead] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // F046 review HIGH-2: 专注阅读模式的退出按钮只在 Coder 分支渲染；Partner 面没有可见
      // 退出 affordance（且 RightSidebar 本就不挂）。Partner 面不接 Ctrl+\，避免把左栏藏掉后
      // 用户找不到退出入口。Partner 想要专注阅读是后续 doc-workspace 的独立设计。
      if (currentSurface === 'partner') return;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '\\') {
        e.preventDefault();
        setFullscreenRead((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentSurface]);

  return (
    <div className="h-screen flex flex-col bg-surface text-fg-primary overflow-hidden relative isolate">
      {/* F060: 背景极光层（玻璃 chrome 通过 backdrop-filter 透出它）。minimal 档不渲染。
          铺在最底层 z-0；下面的 titlebar / body 用 relative z-10 浮在其上。 */}
      <GlassAurora />

      {/* 顶部自定义 titlebar — 自身做窗口拖动 + 留出 Windows overlay 控件 (close/min/max) 空间。
          Mac 上 traffic lights 占 ~78px (hiddenInset)；Windows 上 OS 把 close/min/max 画在右侧 ~138px (titleBarOverlay)。 */}
      <div className="app-titlebar glass ix-zone h-9 flex items-center px-3 flex-shrink-0 select-none relative z-20">
        <div className="text-[12px] text-fg-muted titlebar-brand flex items-center gap-1.5">
          <span className="text-accent-ink text-[13px] leading-none" aria-hidden>
            ✱
          </span>
          <span>
            <span className="text-fg-primary font-semibold">KodaX</span> Space
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDiagnosticsOpen((v) => !v)}
            className="app-no-drag inline-flex h-7 items-center gap-1.5 rounded-md border border-border-default bg-surface-2 px-2 text-[11px] font-mono text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
            title="Runtime diagnostics"
            aria-label="Runtime diagnostics"
          >
            <Info className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            <span>v{version?.spaceVersion ?? '?.?.?'}</span>
          </button>
          <HandoffInbox />
          <VisualQualityToggle />
          <ThemeToggle />
        </div>
        {diagnosticsOpen && (
          <RuntimeDiagnostics version={version} onClose={() => setDiagnosticsOpen(false)} />
        )}
      </div>

      {/* F060: 面板区。Liquid Glass —— 立体感来自光影材质（光向描边 + 光标 specular + 分层柔影），
          不靠运动；模态/命令面板放在面板区之外保持 position:fixed 正常。 */}
      <div className="flex flex-1 min-h-0 gap-2.5 p-2.5">
        {!fullscreenRead && leftSidebarOpen && (
          <>
            <LeftSidebar width={leftWidth} />
            <ResizeHandle
              side="left"
              width={leftWidth}
              defaultWidth={260}
              onPreview={(px) => setLeftWidthDraft(clampSidebarWidthPx(px))}
              onCommit={(px) => {
                setLeftWidthDraft(null);
                setLeftSidebarWidth(clampSidebarWidthPx(px));
              }}
            />
          </>
        )}

        {currentSurface === 'partner' ? (
          // F045: Partner surface 只替换主区（对话区）。LeftSidebar 是全局导航
          // （项目 / session / SurfaceTabs），两 surface 共用，故在本分支外。三栏由 F046 填实。
          <PartnerWorkspace />
        ) : (
          <>
            {/* 中央阅读区：悬浮圆角卡片。保持实色（bg-surface）—— aurora 只在卡片四周缝隙
                透出，对话流不被极光动画触发 re-composite，性能护栏。 */}
            <div className="center-pane flex-1 flex flex-col min-w-0 relative bg-surface rounded-xl border border-border-default overflow-hidden lift">
              <div className="ix-zone flex items-center px-3 h-10 border-b border-border-default flex-shrink-0 gap-1">
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
                    className="ml-1 text-[11px] px-2 py-0.5 rounded border border-border-default text-fg-muted hover:text-fg-primary"
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
                  onPreview={(px) => setRightWidthDraft(clampSidebarWidthPx(px))}
                  onCommit={(px) => {
                    setRightWidthDraft(null);
                    setRightSidebarWidth(clampSidebarWidthPx(px));
                  }}
                />
                <RightSidebar width={rightWidth} />
              </>
            )}
          </>
        )}
      </div>

      {/* 模态/命令面板：在面板区之外，保证 position:fixed 相对视口正常铺满 */}
      <PermissionModal />
      <AskUserModal />
      <HelpOverlayController />
      <CommandPaletteController />

      <ToastContainer />
      <ZoomController />
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
interface RuntimeDiagnosticsProps {
  readonly version: SpaceVersionOutput | null;
  readonly onClose: () => void;
}

function statusClass(status: SpaceCapabilityStatus): string {
  switch (status) {
    case 'supported':
      return 'border-ok/40 bg-ok/10 text-ok';
    case 'partial':
      return 'border-warn/40 bg-warn/10 text-warn';
    case 'blocked':
      return 'border-danger/40 bg-danger/10 text-danger';
    case 'planned':
      return 'border-border-default bg-surface-3 text-fg-muted';
  }
}

function RuntimeDiagnostics({ version, onClose }: RuntimeDiagnosticsProps): JSX.Element {
  return (
    <div className="app-no-drag absolute right-3 top-8 z-50 w-[min(420px,calc(100vw-24px))] rounded-lg border border-border-default bg-surface/95 p-3 text-xs text-fg-secondary shadow-2xl backdrop-blur-xl">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase text-fg-faint">Runtime</div>
          <div className="mt-0.5 font-mono text-fg-primary">
            Space v{version?.spaceVersion ?? '?.?.?'} / KodaX SDK{' '}
            {version?.kodaxSdkVersion ?? 'unknown'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-1.5 py-0.5 text-[11px] text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
          aria-label="Close diagnostics"
          title="Close"
        >
          Esc
        </button>
      </div>

      <div className="mb-2 grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 font-mono text-[11px]">
        <span className="text-fg-faint">contract</span>
        <span>{version?.capabilityContract ?? 'loading'}</span>
        <span className="text-fg-faint">dependency</span>
        <span>{version?.kodaxDependencySpec ?? 'unknown'}</span>
        <span className="text-fg-faint">platform</span>
        <span>
          {version
            ? `${version.platform} / electron ${version.electronVersion} / chromium ${version.chromeVersion}`
            : 'loading'}
        </span>
      </div>

      <div className="max-h-60 space-y-1 overflow-auto pr-1">
        {(version?.capabilities ?? []).map((capability) => (
          <div
            key={capability.id}
            className="rounded-md border border-border-default bg-surface-2 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium text-fg-primary">
                {capability.label}
              </span>
              <span
                className={`flex-shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${statusClass(
                  capability.status,
                )}`}
              >
                {capability.status}
              </span>
            </div>
            <div className="mt-1 text-[11px] leading-4 text-fg-muted">{capability.detail}</div>
          </div>
        ))}
        {!version && (
          <div className="rounded-md border border-border-default bg-surface-2 px-2 py-2 text-fg-muted">
            Loading diagnostics...
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarToggleButton({ side, open, onClick }: SidebarToggleButtonProps): JSX.Element {
  const Icon = side === 'left' ? PanelLeft : PanelRight;
  const label = `${open ? 'Hide' : 'Show'} ${side} sidebar`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ix-pop w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-hover-bg ${
        open ? 'text-fg-primary' : 'text-fg-muted hover:text-fg-primary'
      }`}
      title={label}
      aria-label={label}
      aria-pressed={open}
    >
      <Icon className="w-4 h-4" strokeWidth={1.75} />
    </button>
  );
}
