# F067 — LiveCanvas Artifact Sandbox 重新集成（交互 React tier）

> Status: **Planned**（blocked on LiveCanvas 包结构稳定）
> Category: New · Priority: Medium · Version: TBD
> 关联记忆：`livecanvas_artifact_plan`、`recharts_v3_and_lc_sandbox_bridge_block`

## 背景：为什么先被移除（2026-06-17）

Artifact 分两层：

- **静态层（LC-free，唯一发布层）**：markdown / code / html / svg / image / **chart(recharts)** /
  pdf / docx / xlsx。完全由 Space 自有渲染器渲染，不依赖 LiveCanvas。**保留，未受影响。**
- **交互层（`react` kind，路径 D）**：在 LiveCanvas sandbox `<iframe>` 里跑 AI 生成的 React。
  原设计用 `import.meta.env.DEV` 门控 + 类型 stub「隔离」，意图是发布构建 DCE 掉、不依赖 LC。

**隔离漏洞**：Rollup/Vite 在 tree-shake **之前**必须先解析整张模块图，`SandboxFrame.tsx` 顶部的
`import { createHost } from '@livecanvas/sandbox-bridge'` 必须能解析到才肯继续——哪怕之后被 DCE。
之前靠 `node_modules/@livecanvas/sandbox-bridge` 的 dev-link junction 才解析得过。

2026-06-17 LiveCanvas 仓重构，删除/改名了 `sandbox-bridge`、`canvas-protocol` 包（现为
`@livecanvas/protocol` / `@livecanvas/ui-sandbox` 等）。任何没有 LC link 的机器上：

- `npm run dev` → Vite dev server 解析不了 `@livecanvas/sandbox-bridge` → electron 起不来
- `npm run build` → renderer 构建在同一行失败 → 无有效 pack → 打包 app 起不来

即「dev-only 半成品脚手架反过来卡死主产品在所有未 link LC 的机器上」。故先**整支移除**交互层运行时机器，
让 Space 在任何机器零 LC 依赖地 dev / build / 打包，交互层作为本 feature 之后重接。

## 移除了什么（2026-06-17，commit 见 git）

Renderer：`SandboxFrame.tsx`、`smokeArtifact.ts`、`useSandboxInfo.ts`（已是孤儿）、
类型 stub `types/livecanvas-sandbox-bridge.d.ts`；`ArtifactView` 的 LC lazy 渲染路径；
`artifactKind.isReactArtifactEnabled`；`artifactContent` 的 `react` 变体简化为裸 `{ kind: 'react' }`。

Electron：`artifact/{sandbox-host,sandbox-server,bundle-resolver,static-serve}.ts`；
`main.ts` 的 sandboxHost start/dispose + import；`ipc/artifact.ts` 的 `artifact.sandboxInfo` 注册。

Schema：`artifactSandboxInfoChannel` + `ArtifactSandboxInfo` 类型 + `channels/index` 注册 + 包 re-export。

测试/e2e：`sandbox-host.test.ts`、`sandbox-server.test.ts`、`e2e/artifact-sandbox-render.mjs`。

**保留**：`react` 仍在 `artifactKindSchema` enum（纯数据类型，删要动数据模型）；`react` artifact
渲染为「交互式预览暂未启用」占位。静态层 + 数据层（F056/F057/F058/F059）一行未动。

## 重新集成时要做（本 feature）

1. **前置**：LiveCanvas 包结构稳定 + 发布到 npm（或确定 dev-link 包名）。确认新包名/导出：
   `createHost`/`Host`（原 `@livecanvas/sandbox-bridge`）落到 `@livecanvas/protocol` 还是 `ui-sandbox`。
2. **构建鲁棒性（关键，别重蹈覆辙）**：renderer 对 LC 包**不能**用顶层静态 import 直挂主图。
   选项：(a) 真 external + 运行时按需 import；(b) Vite `resolve.alias` 在未 link 时回退到本地 stub；
   (c) 把交互层做成可选 entry，构建探测 LC 是否存在再纳入。**目标硬约束：没有 LC 也能 dev/build/pack。**
3. 重建 renderer 交互渲染（SandboxFrame 等）、electron loopback sandbox server（host/server/
   bundle-resolver/static-serve）、`artifact.sandboxInfo` 通道、`isReactArtifactEnabled` 门控、
   `react` ArtifactContent 变体的 LC 字段。
4. F055（`app://` 自定义协议）做 origin pinning 后，补回打包态 `frame-ancestors` 隔离。
5. 回归：build + artifact e2e（`.recharts-surface` 静态图 + sandbox iframe 渲染）。

## 验收

- 在**没有** LiveCanvas 仓/link 的干净机器上：`npm run dev`、`npm run build`、win pack 启动全部正常。
- 有 LC link 时交互 React artifact 在 sandbox iframe 内渲染。
