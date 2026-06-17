# Workflow Harness 支持批次（F060–F066）

> 2026-06-17 起草。对标 KodaX SDK 的 **Dynamic Workflow Harness**（FEATURE_217 @ 0.7.49）+ **Workflow Process Events**（FEATURE_229 @ 0.7.50），把 KodaX 新增的多 agent 编排能力在 KodaX Space 的 GUI 里接通。
>
> 拟版本 **v0.1.15**（待用户确认）。本文件是批次设计文档；ship 时按惯例把每个 FEATURE 的设计正文挪进 `docs/features/v0.1.15.md` 并在 `FEATURE_LIST.md` 建索引行。
>
> 关联：[ADR-003 KodaX 集成（in-process）](../ADR/ADR-003-kodax-integration-in-process.md) · [ADR-004 面板模型](../ADR/ADR-004-panel-model.md) · 拟新增 **ADR-008 Workflow 作为 Space 一等进程面**。

---

## 0. 背景：SDK 给了什么

KodaX 0.7.49 落地「动态工作流引擎」——agent 可生成/运行一段编排脚本，fan-out 多个**子 agent** 并行干活（phase / parallel / pipeline、worktree 隔离、token 预算硬停、saved workflow、`/workflow` 命令、durable `run.json`+`events.jsonl`+`artifacts/`）。这与 Space 当前「一个 session = 一个 agent = 一条线性事件流」的模型是**结构性升维**。

0.7.50 把工作流进度从「REPL 私有文本」提升为**可订阅的一等进程**（FEATURE_229），并给 SDK host（= Space）专门开了一套消费面。Space 要做的不是重新实现编排，而是**把这套进程模型在 GUI 里渲染、控制、入口化**——REPL 在终端里 inline/fullscreen 渲染工作流，Space 需要等价的图形面。

### 0.1 Host 可达的 SDK API（已核对 .d.ts + exports）

导入路径（Space 已 external 这些子路径，动态 `import()` 走 ESM 条件）：

| 能力 | 符号 | 导入路径 |
|---|---|---|
| 生命周期控制器 | `createWorkflowLifecycleController` | `@kodax-ai/kodax/coding` |
| 进程运行管理器 | `createWorkflowRunManager` / `getDefaultWorkflowRunManager` | `@kodax-ai/kodax/coding` |
| 程序化启动 | `runWorkflowFromOptions` / `runWorkflowModule` | `@kodax-ai/kodax/coding` |
| 子 agent 后端 | `createCodingWorkflowBackend` | `@kodax-ai/kodax/coding` |
| saved/built-in 发现 | `discoverSavedWorkflows` / `listBuiltinWorkflows` / `loadSavedWorkflow` | `@kodax-ai/kodax/coding` |
| 预检 | `preflightWorkflowCapsule` | `@kodax-ai/kodax/coding` |
| 身份解析 | `resolveWorkflowIdentity` | `@kodax-ai/kodax/coding` |
| 进程模型类型 | `WorkflowProcessSnapshot` / `WorkflowProcessEvent` / `WorkflowProcessItem` / `WorkflowEventCorrelation` / `isFinalWorkflowProcessStatus` | `@kodax-ai/kodax/coding`（或 root） |
| 事件回调面 | `KodaXEvents.onWorkflowProcessEvent`、`KodaXOptions.workflowHostPolicy`、`WorkflowHostPolicy`、`KodaXToolEventMeta`/`KodaXActivityEventMeta`/`KodaXWorkflowEventMeta` | `@kodax-ai/kodax`（root） |
| 系统硬上限 | `SYSTEM_WORKFLOW_LIMITS = { maxAgents: 64, maxConcurrency: 16, tokenBudget: 200000 }` | `@kodax-ai/kodax/coding` |

> `createWorkflowRuntime` / `runWorkflow`（低层原语）只在 `@kodax-ai/kodax/agent` 暴露，Space **不直接用**——一律走 `WorkflowRunManager` + `WorkflowLifecycleController`。`WorkflowProcessTracker` 是 SDK 内部 reducer，host 不实例化。

### 0.2 核心类型（渲染契约的真相源）

```ts
type WorkflowProcessStatus     = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
type WorkflowProcessItemKind   = 'phase' | 'agent' | 'step' | 'artifact';
type WorkflowProcessItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';
type WorkflowProcessSummaryStatus = 'pending' | 'result' | 'notice' | 'unavailable';

interface WorkflowProcessItem {        // 进度树节点
  id; title; kind; status;
  phaseId?; parentId?; agentId?; childAgentId?;
  provider?; model?; startedAt?; endedAt?;
  summary?; summaryStatus?; error?;
}
interface WorkflowProcessSnapshot {     // 一次 run 的全量快照（每次状态变化重发）
  runId; workflowName; displayName?; status;
  startedAt; updatedAt; elapsedMs?; goal?; source?;
  activePhaseId?; activePhaseIndex?; phaseCount?;
  items: WorkflowProcessItem[];
  counts;          // pending/running/completed/failed/cancelled/skipped
  progress;        // spawnedAgents/finishedAgents/activeAgents/failedAgents/stoppedAgents/agentCap/plannedItems
  tokens?;         // { spent, total? }
  latestMessage?; resultSummary?; error?;
  artifacts?;      // { name, path?, description? }[]
}
type WorkflowProcessEvent =
  | { type: 'workflow_started';  snapshot }
  | { type: 'workflow_updated';  snapshot; message? }
  | { type: 'workflow_finished'; snapshot };
```

**关键设计点**：每个事件都带**全量 snapshot**（不是增量 patch），renderer 直接 `runId → snapshot` 覆盖即可，无需自己折叠事件。`WorkflowEventCorrelation`（`workflowRunId`/`childAgentId`/`phaseId`/`itemId`）挂在普通 tool/activity 事件的 meta 上，让 Space 把每条子 agent 的工具/思考事件归因到具体 run + 子 agent。

### 0.3 Space 现状缺口（集成 agent 调研结论）

| 关注点 | 现状 | 缺口 |
|---|---|---|
| SDK 调用 | `runManagedTask`（[real-session.ts:826](../../apps/desktop/electron/kodax/real-session.ts)） | 没传 `workflowHostPolicy`；没订阅 `onWorkflowProcessEvent` |
| 事件类型 | 20+ 种已接，**全是线性单 agent** | 无子 agent / workflow 进程事件 |
| IPC | `session.event` push 通道 | 需新增 `workflow.event` 通道 + schema |
| Renderer state | 每 session 一条扁平事件环 | 无 run 树 / 子 agent 结构 |
| UI 面 | Coder + Partner 双面板 | 无工作流进度面、无库、无子 agent 面 |
| Agent mode | AMA/SA 切换（AMAW 被折叠回 ama 显示） | autoStart 策略、workflow 入口未暴露 |
| Artifact | per-session/surface（F057-F059） | **可复用**：workflow artifact 直接进现有 artifact 层 |

---

## 1. 批次总览与依赖

```
F060 Workflow 进程事件管线 (main→renderer 地基)
   ├─► F061 Workflow 进度面板 (GUI 渲染 snapshot 树)
   ├─► F062 Run 生命周期控制 (stop/pause/resume/rename/prune)
   ├─► F065 子 agent 活动遥测面 (correlation 归因)
   └─► F066 Workflow 结果 + artifact 展示 (复用 F057-F059)
F063 Workflow 库 + 启动 + preflight (saved/built-in 入口)
F064 AMAW 自然语言自启 + Host policy (入口 + 极简策略)
```

F060 是地基，先做。F063/F064 是「人怎么发起工作流」的两个入口（显式库启动 / 自然语言自启）。设计遵循「**极简且智能**」：不把 `maxAgents`/`maxConcurrency`/`tokenBudget` 当裸旋钮丢给用户，给智能默认 + 一个「自启确认」轻量闸。

| ID | Title | Priority | 依赖 |
|----|-------|----------|------|
| F060 | Workflow 进程事件管线（main→renderer） | Critical | SDK 0.7.50 |
| F061 | Workflow 进度面板（phase/agent/step 树） | High | F060 |
| F062 | Run 生命周期控制（stop/pause/resume/rename/prune） | High | F060 |
| F063 | Workflow 库 + 启动 + capsule preflight | High | F060 |
| F064 | AMAW 自然语言自启 + Host policy（极简） | Medium | F060, F063 |
| F065 | 子 agent 活动遥测面（correlation 归因） | Medium | F060 |
| F066 | Workflow 结果 + artifact 展示（复用 F057-F059） | Medium | F060 |

---

## FEATURE_060: Workflow 进程事件管线（main→renderer）

### 需求概述
把 SDK 的 `WorkflowProcessEvent` 流接到 renderer，作为整个批次的地基。一份真相源：main 进程订阅 → zod 校验 → `workflow.event` push 通道 → renderer store。打开 session 时用 `listWorkflowProcessSnapshots()` 播种历史 run。

### 影响范围
- `apps/desktop/electron/kodax/real-session.ts`：`runManagedTask` 的 `KodaXOptions.events` 里挂 `onWorkflowProcessEvent`；options 加 `workflowHostPolicy`（F064 用，本 feature 给默认值）。
- 新建 `apps/desktop/electron/kodax/workflow-controller.ts`：用 `getDefaultWorkflowRunManager()` + `createWorkflowLifecycleController({ runManager, runBaseDir, savedWorkflowDirs })` 持一个进程级控制器（与 AMAW/REPL 共享 manager）。
- `apps/desktop/electron/ipc/`：新增 `workflow.*` invoke 通道（list/get/snapshot）+ `workflow.event` push。
- `packages/space-ipc-schema/src/channels/workflow.ts`：新建，zod 镜像 `WorkflowProcessSnapshot/Event/Item`。
- `apps/desktop/renderer/src/store/appStore.ts`：新增 `workflowRunsBySession: Record<string, Record<runId, WorkflowProcessSnapshot>>` slice。

### 技术方案
1. **进程级控制器单例**（main）。`runBaseDir` 用 `getAgentConfigPath('workflows','runs')` 之类的 KodaX 配置路径（与 SDK 落盘一致，避免双源）。`savedWorkflowDirs` 取默认（含 built-in + 用户 `~/.kodax/...`）。
2. **订阅**：`controller.subscribeWorkflowProcess(evt => pushToRenderer('workflow.event', evt))`。同时在 `runManagedTask` 的 events 里挂 `onWorkflowProcessEvent`（两条来源去重：以 `runId+updatedAt` 幂等，renderer 覆盖式写入天然幂等）。
3. **关联到 session（interim，等 SDK 补归属字段）**：snapshot 无 host 归属字段（见 §3.2 SDK 需求）→ main 侧维护并**自持久化**一张 `runId → {sessionId, surface}` 映射表（落 `~/.kodax/space/workflow-origins.json`，进程重启后仍能归属；启动/AMAW 自启时写入），push 时据此附带 `sessionId`/`surface`。无法归属的（外部 REPL/CLI 起的 run）归到 `__external__` 桶，只读展示。SDK 补字段后，这张侧表可下线、改读 snapshot 自带的 origin。
4. **播种**：renderer 切到某 session 时 `invoke('workflow.list', { sessionId })` → `controller.listWorkflowProcessSnapshots()` 过滤。
5. **零编排逻辑**：Space 只订阅/转发/渲染，绝不自己折叠 `WorkflowEvent`（snapshot 已是折叠结果）。

### 接口契约
```ts
// packages/space-ipc-schema/src/channels/workflow.ts
workflow.list   : (in: { sessionId?: string }) → { runs: WorkflowProcessSnapshot[] }
workflow.get    : (in: { runId: string })      → { run: WorkflowProcessSnapshot | null }
// push
workflow.event  : WorkflowProcessEvent & { sessionId?: string }
```
zod schema 必须与 SDK 类型逐字段对齐；`enum` 用 SDK 的字面量联合，避免 drift（记忆 [[feedback_mock_fidelity]]：改 SDK 调用边界别只靠 mock 过测）。

### 实现步骤
1. schema 包加 `workflow.ts` + 注册到 `INVOKE_CHANNEL_NAMES`/`PUSH_CHANNEL_NAMES`。
2. main 建 `workflow-controller.ts` 单例 + 订阅转发。
3. `register.ts` 注册 `workflow.list`/`workflow.get`；`push.ts` 走 `workflow.event`。
4. preload 把 `workflow.event` 加进 `ALLOWED_LISTEN_CHANNELS`。
5. appStore 加 slice + `upsertWorkflowRun(snapshot)` action（覆盖式）。
6. 真 SDK 起一个 built-in workflow（如 `parallel-investigation`）端到端验证事件到达 renderer。

### 验收标准
- 起一个内置只读工作流，renderer store 里出现该 run 的 snapshot，并随 phase/agent 推进实时更新，`workflow_finished` 后 status 进终态。
- 关掉再开 session，`workflow.list` 能播种已结束的 run。
- 单测：schema round-trip（SDK 形状 → zod parse → 不丢字段）；mock controller 推三类事件 → store 覆盖正确。
- **不靠 mock 充信心**：必须有一条用真 SDK `runWorkflowFromOptions` 的集成验证。

---

## FEATURE_061: Workflow 进度面板（phase/agent/step 树）

### 需求概述
REPL inline/fullscreen 工作流面的 GUI 等价物。渲染 `snapshot.items[]` 为 phase → agent/step 树，带 status 图标、counts、progress（spawned/finished/active agents + agentCap）、token 用量（spent/total）、`latestMessage` 活动行。

### 影响范围
- 新建 `apps/desktop/renderer/src/features/workflow/WorkflowPanel.tsx` + 子组件（`WorkflowRunCard` / `WorkflowItemTree` / `WorkflowProgressBar`）。
- 复用 F059 popout 机制（工作流面可浮出/最大化，跟 artifact 同款）。
- **只挂 Coder surface 布局**（v0.1.15 决策：workflow 仅给 Coder，Partner 暂不开）。

### 技术方案
- 纯展示组件，数据来自 F060 store slice。`items` 按 `parentId`/`phaseId` 构树；`kind` 决定图标（phase=阶段条、agent=子 agent 卡、step=步骤、artifact=产物链接）。
- `status` → 颜色/动效（running 脉冲、failed 红、skipped 灰）。`summaryStatus`：`pending` 显「生成摘要中…」、`result` 显 digest、`unavailable` 诚实显「摘要不可用，见原始结果」（对齐 SDK 的 async digest split 语义，不拿占位当摘要）。
- 多 run：一个 session 可有多个 run（历史 + 活跃），列表 + 展开。`isFinalWorkflowProcessStatus` 判终态折叠。
- 「极简且智能」：默认只显活跃 run 的精简进度条 + 当前 phase + latestMessage；点开才展开完整树。

### 接口契约
纯 props 驱动，无新 IPC。`WorkflowPanelProps { runs: WorkflowProcessSnapshot[]; onStop/onPause/onResume?(runId) }`（控制动作在 F062 接线）。

### 实现步骤
1. 树构建工具 `buildItemTree(items)` + 测试。
2. 展示组件分层（card/tree/progress/token）。
3. 接 store selector（按 currentSession 取 runs）。
4. 接 F059 popout。
5. 空态/错误态（`snapshot.error`）渲染。

### 验收标准
- 一个含 phase + 多并行子 agent 的工作流，树实时反映每个子 agent 的 running→completed，counts/progress 同步。
- token 进度条随 `tokens.spent/total` 增长；逼近 cap 有视觉提示。
- digest 三态（pending/result/unavailable）正确呈现。
- 长名工作流不撑破布局（对齐 SDK 修过的 footer 高度问题）。

---

## FEATURE_062: Run 生命周期控制（stop/pause/resume/rename/prune）

### 需求概述
把 `WorkflowLifecycleController` 的控制方法接到 UI：停止/暂停/恢复进行中的 run；重命名 run 显示名；删除/清理终态 run（带活跃保护）。

### 影响范围
- `workflow-controller.ts` 暴露控制方法。
- 新 invoke 通道 `workflow.stop/pause/resume/rename/delete/prune`。
- `WorkflowPanel` 接控制按钮。

### 技术方案
- main 侧薄包装：`controller.stopWorkflow(runId, reason?)` / `pauseWorkflow` / `resumeWorkflow` / `renameWorkflowRun(runId, name)` / `deleteWorkflowRun(runId, opts)` / `pruneWorkflowRuns(retentionOpts)`。
- 全部返回 `boolean`/结果，包成标准 `ok/fail` envelope。活跃 run 删除被 SDK 拒（active-run protection）→ UI 给明确提示。
- 控制后状态由 `workflow.event` 自然回流（stop → 后续 `workflow_finished` status=cancelled），UI 不乐观假设，等事件。

### 接口契约
```ts
workflow.stop   : { runId, reason? } → { ok: boolean }
workflow.pause  : { runId } → { ok: boolean }
workflow.resume : { runId } → { ok: boolean }
workflow.rename : { runId, displayName } → { ok: boolean }
workflow.delete : { runId, force?: boolean } → { ok: boolean }
workflow.prune  : { keepLast?: number, olderThanMs?: number } → { removed: number }
```

### 实现步骤
1. controller 包装方法 + 通道注册。
2. WorkflowPanel 控制条（stop/pause/resume 按钮按 status 条件显隐）。
3. 重命名 inline 编辑。
4. 终态 run 的删除/批量清理入口（库面里）。

### 验收标准
- 停止一个跑着的工作流 → 子 agent 标 cancelled（never-started 标 skipped），run 进 cancelled 终态。
- 暂停→恢复往返，进度正确续上。
- 删活跃 run 被拒并提示；删终态 run 成功且从 UI 移除。

---

## FEATURE_063: Workflow 库 + 启动 + capsule preflight

### 需求概述
显式入口：浏览 built-in + saved 工作流，选一个启动；启动前用 `preflightWorkflowCapsule` 展示需求（环境/工具/MCP/skills/model tier）并校验，避免「跑到一半缺依赖」。含 `/workflow create <request>` 生成 + save。

### 影响范围
- 新建 `apps/desktop/renderer/src/features/workflow/WorkflowLibrary.tsx`。
- `workflow-controller.ts` 接 `discoverSavedWorkflows`/`listBuiltinWorkflows`/`loadSavedWorkflow`/`preflightWorkflowCapsule`/`runWorkflowFromOptions`（经 manager.startFromOptions）。
- 新通道 `workflow.library.list` / `workflow.preflight` / `workflow.start` / `workflow.save` / `workflow.create`。

### 技术方案
- 库列表：built-in（`listBuiltinWorkflows`）+ saved（`discoverSavedWorkflows(dirs)`）合并展示，标来源/只读标志/phase 数/maxAgents 等 manifest 元数据。
- **预检面**：选中 → `preflightWorkflowCapsule` → 渲染 `WorkflowCapsuleRequirements`（environment 如 git-repo/worktree-capable、tools、mcp、skills、modelTiers、userInteraction）。缺失项红标，齐了才允许「启动」。
- **启动**：`manager.startFromOptions({ module, args, options: <当前 session 的 KodaXOptions>, runId, runDir, onWorkflowProcessEvent })`。main 记 `runId→sessionId` 映射（供 F060 归属）。返回 runId，UI 切到 F061 进度面。
- **生成**：`/workflow create <request>` 走 SDK 生成器 → 产出 capsule → 预检 → 可 `workflow.save <name>`。生成脚本经 SDK `validateRestrictedWorkflowSource` + repair loop（SDK 内做，Space 只展示结果/审批）。
- 审批：启动/生成的审批面展示 source/sandbox/worktree 意图（对齐 SDK approval 语义）。

### 接口契约
```ts
workflow.library.list : {} → { builtin: WorkflowRef[], saved: SavedWorkflowRef[] }
workflow.preflight    : { target: string } → WorkflowCapsulePreflightResult
workflow.start        : { target: string, args?: unknown, sessionId: string } → { runId: string }
workflow.create       : { request: string, sessionId: string } → { capsule: WorkflowCapsule, preflight }
workflow.save         : { runId|capsuleRef, name: string } → { ref: SavedWorkflowRef }
```

### 实现步骤
1. controller 接库/预检/启动方法 + 通道。
2. WorkflowLibrary 列表 + 来源/元数据展示。
3. 预检面（需求清单 + 缺失高亮 + 启动闸）。
4. 启动 → runId → 跳 F061。
5. create/save 流程 + 审批面。

### 验收标准
- 库里能看到内置 `parallel-investigation` 等 + 用户 saved。
- 选一个缺 MCP 依赖的工作流，预检红标并禁止启动；补齐后可启动。
- `/workflow create "审查这个 PR 的安全问题"` 生成 capsule、预检通过、可保存复用。
- 启动后进度面实时显示，artifact/结果回流（F066）。

---

## FEATURE_064: AMAW 自然语言自启 + Host policy（极简）

### 需求概述
自然语言触发工作流（AMAW = Adaptive Multi-Agent Workflow 自启）由 `WorkflowHostPolicy.autoStart` 治理。按「极简且智能」：不暴露裸 caps 旋钮，给智能默认 + 一个「自启确认」轻量闸——用户随口说「把这几个模块并行重构」，Space 识别值得起工作流时**确认一次**再 fan-out，而非静默吃掉一大把 token。

### 影响范围
- `real-session.ts`：`KodaXOptions.workflowHostPolicy` 装配。
- 新增「工作流自启」确认 UX（复用 permission/askUser 弹窗机制）。
- 设置面：一个三档开关（关 / 确认 / 自动），默认**确认**。

### 技术方案
- `workflowHostPolicy = { autoStart: 'off' | 'confirm' | 'on', maxAgents, maxConcurrency, tokenBudget }`。
  - `autoStart` 默认 `'confirm'`：SDK 判定该自启时，Space 拦一个确认（展示预计 agent 数/token 预算/工作流意图），用户点「起」才放行。`'on'` 透明自启；`'off'` 禁 AMAW（仍可显式库启动）。
  - caps：默认取保守值（远低于 `SYSTEM_WORKFLOW_LIMITS` 的 64/16/200k），按「极简」不暴露为旋钮；高级用户可在设置里调，但 UI 默认折叠。**不能超过 KodaX 硬上限，也不能绕子 agent 权限闸**（SDK 强制）。
- 确认闸数据来自 SDK 的自启决策（`decideWorkflowInvocation` 之类）→ Space 渲染意图摘要。
- 与 AMA/SA 选择器的关系：AMAW 是 AMA 下的自启子路径，**不新增第四种 agentMode 标签**（对齐 SDK 把 amaw 折叠回 ama 显示的现状，记忆 [[partner_batch_progress]] 的 amaw drift 陷阱）。

### 接口契约
```ts
// 设置持久化
workflow.policy.get : {} → WorkflowHostPolicy
workflow.policy.set : Partial<WorkflowHostPolicy> → WorkflowHostPolicy
// 自启确认（复用 ask-user 风格）
push ask-user.request 变体 / 或新 push workflow.autostart.request : { intent, plannedAgents, tokenBudget } → 用户裁决
```

### 实现步骤
1. policy 持久化（provider-config 同款 json）+ 装配进 options。
2. 自启确认弹窗（意图 + 规模预估）。
3. 设置面三档开关（默认 confirm），caps 折叠在「高级」。
4. 端到端：自然语言请求 → 确认 → 工作流起 → 进度面。

### 验收标准
- 默认 confirm：随口的多步请求触发确认闸，拒绝则照常单 agent 跑，接受则起工作流。
- 切 off：不再自启，库启动仍可用。
- caps 默认保守且不可超 KodaX 硬上限；调高被 clamp。

---

## FEATURE_065: 子 agent 活动遥测面（correlation 归因）

### 需求概述
用 `WorkflowEventCorrelation`（挂在 tool/activity 事件 meta 上）把每条子 agent 的工具/思考/文本事件归因到具体 run + 子 agent，渲染一个有界的「子 agent 活动面」，而不是把 N 个子 agent 的输出灌进主 transcript（对齐 SDK 的 `ChildActivitySurface`）。

### 影响范围
- `real-session.ts` 的现有 tool/activity 事件 handler 加读 `meta.correlation`（SDK 0.7.50 给事件加了可选尾参 meta）。
- F060 store slice 扩展：按 `workflowRunId + childAgentId` 分桶活动事件。
- `WorkflowPanel` 里每个 agent 卡可展开看其活动流。

### 技术方案
- 事件 handler：`onToolUseStart(evt, meta?)` 等，若 `meta.correlation?.workflowRunId` 存在 → 路由到 workflow 子桶，**不进**主 session 事件环。无 correlation 的照旧进主 transcript。
- 有界缓冲：每个子 agent 留最近 N 条活动（防爆内存），完成时 `onChildActivityEnd` 边界收尾。
- 主 transcript 只留主 agent 的「起了个工作流」摘要卡 + 指向进度面的链接，保持干净。

### 接口契约
`workflow.event` 之外，活动走现有 `session.event` 通道但带 correlation 分流；或新增 `workflow.activity` push（倾向后者，干净隔离）。

### 实现步骤
1. 确认 SDK 事件 meta 尾参形状（`KodaXToolEventMeta`/`KodaXActivityEventMeta`/`KodaXWorkflowEventMeta`）。
2. handler 分流逻辑 + 有界缓冲。
3. store 子桶 + selector。
4. agent 卡展开活动流 UI。

### 验收标准
- 三个并行子 agent 的工具调用各自归到自己的卡里，主 transcript 不被淹。
- 子 agent 完成有明确边界，活动流封口。
- 无 correlation 的普通单 agent 事件行为不变（回归）。

---

## FEATURE_066: Workflow 结果 + artifact 展示（复用 F057-F059）

### 需求概述
工作流产出的结果（displayable JSON/markdown）和 artifacts 在 Space 现有 artifact 层呈现，复用 F057 store + F059 三级展示。支持 `/workflow revise` 迭代一个 capsule。

### 影响范围
- `workflow-controller.ts` 接 `readWorkflowResult(runId)` / `readWorkflowArtifact(runId, name)`。
- 把 workflow artifacts **桥进 `artifactStore`**（方案 A，已定）。
- revise 流程接 `controller`（rename/revise/replace saved）。

### 技术方案
- **结果**：`workflow_finished` 后 `readWorkflowResult(runId)` 取最终 displayable result（SDK 已 lint 过非空对象/数组），渲染进进度面顶部「结果」区，可复制/导出（复用 F059b 导出）。
- **artifacts（方案 A —— 桥进 Space artifact 层，2026-06-17 定）**：snapshot.artifacts[] 给元数据，`readWorkflowArtifact(runId, name)` 取内容；Space 把每个 workflow artifact `artifactStore.upsert({ sessionId: <发起 session>, surface:'code', kind, title, content })` 复制进自己的 store。于是 workflow 产物与 agent 直接产的 artifact **统一在同一面板**，复用 F057-F059 全套预览/版本/导出/弹窗，符合 F059「artifact 全局可见」。
  - **kind 映射**：workflow artifact 的类型 → Space `ArtifactKindT`（markdown/code/html/svg/chart/image/...）。无法识别的回退 `code` 或 `markdown`（按内容嗅探），不丢内容。
  - **幂等/去重**：同一 run 的同名 artifact 重复 upsert 用稳定 id（如 `wf:<runId>:<name>`）走「追加版本」而非新建，避免重复条目。
  - **数据双份**：artifact 同时在 run 目录与 artifacts.json —— 可接受（artifact 有大小上限）；run 目录是 SDK 真相源，artifacts.json 是 Space 展示副本。
  - **attribution**：归到发起该 run 的 session（依赖 F060 的 `runId→sessionId` 映射）。
- **revise**：`/workflow revise <runId|name> <change>` → SDK 生成新 capsule 修订（append-only，不改历史 run 图）；`--replace <savedName>` 移动 saved 名并归档旧版到 `.revisions/`。Space 给修订入口 + 审批。

### 接口契约
```ts
workflow.result   : { runId } → { result?: string }
workflow.artifact : { runId, name } → { content?: unknown }
workflow.revise   : { target, change, replace?: boolean } → { capsule, preflight }
```

### 实现步骤
1. controller 接 result/artifact/revise + 通道。
2. 结果区渲染 + 导出复用。
3. workflow artifact → artifactStore 桥接（attribution）。
4. revise 入口 + 审批 + 重新预检。

### 验收标准
- 工作流结束，结果区显示最终 result，可复制/另存。
- 工作流产的 artifact 出现在 artifact 面，可预览/导出/版本，与普通 artifact 一致。
- `/workflow revise` 产出新修订、不动历史 run，可再启动。

---

## 2. 跨切关注点

- **真相源唯一**：Space 零编排逻辑，只订阅 snapshot + 转发 + 渲染。绝不自己解析 `events.jsonl` 或折叠 `WorkflowEvent`（snapshot 即折叠结果）。落盘路径与 SDK 共用 `runBaseDir`，不建第二套存储（记忆 [[space_session_ux_findings]] 的索引 workaround 教训）。
- **SDK 边界纪律**：所有 workflow 调用是改 SDK 调用边界的行为，必须有真 SDK 集成验证，不只过 mock（记忆 [[feedback_mock_fidelity]]）。
- **amaw 显示一致性**：不新增第四 agentMode；AMAW 是 AMA 子路径（记忆 [[partner_batch_progress]] 的 amaw drift）。
- **极简且智能**：caps 不当裸旋钮；自启默认「确认一次」；进度面默认精简、点开才全展开（记忆 [[minimal_intelligent_philosophy]]）。
- **能力归属**：编排/生成/worktree/token 预算/子 agent 权限闸全归 KodaX 内核；Space 只做订阅/渲染/控制/入口。若发现 host 面缺字段（如 snapshot 缺 sessionId 归属），写需求给 KodaX，不在 Space 反推（记忆 [[dont_touch_kodax_sdk]] [[kodax_sdk_export_gaps]]）。

## 3. 决策记录（2026-06-17 用户确认）

1. **版本**：✅ **v0.1.15**。（暂不强制拆小版本；若工期紧再把地基 F060-F062 先 ship。）
2. **run→session 归属**：⚠️ **确认为 SDK 缺口，已开需求转交 KodaX**。`WorkflowRunProcessMetadata = Pick<…,'displayName'|'goal'|'source'|'savedWorkflowName'|'sourceRunId'|'sourceWorkflowName'|'revisionOf'>` 无 host 自定义槽位；`WorkflowProcessSnapshot` 不回显归属、run.json 不持久化。诉求：加 `origin?:{sessionId?;tag?}` 或 `hostMetadata?` 并持久化 + 回显。**SDK 补之前**：F060 用 Space 自持久化的 `runId→{sessionId,surface}` 映射做 interim；外部（REPL/CLI）发起的 run 归到 `__external__` 桶只读展示。
3. **artifact 桥接**：✅ **方案 A（桥进 `artifactStore`）**。workflow 产物复制进 Space artifact 层，与 agent 直接产的统一面板，复用 F057-F059 预览/版本/导出/弹窗。见 F066 技术方案（kind 映射 + 稳定 id 幂等 + attribution）。
4. **Partner surface**：✅ **只给 Coder**。workflow 仅在 Coder surface 接通；Partner 暂不开（F061/F066 的展示面只挂 Coder 布局）。
