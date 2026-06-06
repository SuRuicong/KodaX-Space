# KodaX Space — 使用指南 (v0.1.6 alpha)


KodaX Space 是 KodaX SDK 的桌面客户端。设计目标：**不要让用户在 Space 和 KodaX CLI 之间重复配置**。绝大多数 KodaX CLI 已经配好的东西，Space 启动后会自动认。

## 1. 启动

目前没有打好的安装包，开发期请从源码起：

```bash
git clone https://github.com/icetomoyo/KodaX-Space.git
cd KodaX-Space
npm install --include=dev   # 显式带 devDependencies，避免 npm config omit=dev 漏装
npm run dev
```

`npm run dev` 同时起 Vite renderer dev server 和 Electron main，HMR 默认开。窗口出来后即可 `/help` 看可用命令。

如要本地打包验证：

```bash
npm run typecheck   # 通过才往下
npm run test        # 348 个测试，应该全过
npm run build:win   # Windows；mac 走 build:mac
```

## 2. 配置复用矩阵 (Space ↔ KodaX CLI)

| KodaX 配置 | Space 行为 | 备注 |
|---|---|---|
| `~/.kodax/config.json` → `mcpServers` | ✅ 自动加载 (SDK listMcpServers) | global server 直接出现在 MCP popout |
| `~/.kodax/config.json` → `provider` | ✅ 首次自动选 | Space `defaultProviderId === null` 时 fallback；切过下拉用 Space 的 |
| `~/.kodax/config.json` → `reasoningMode` / `reasoningCeiling` | ✅ 新 session 初值 | reasoningCeiling (v0.7.29+) 优先；session 内 `/reasoning` 切 |
| `~/.kodax/config.json` → `permissionMode` | ✅ 'plan' / 'accept-edits' 1:1 | KodaX 'default'/'bypass-permissions' Space 不复刻，走 Space 默认 |
| `~/.kodax/config.json` → `thinking` | ✅ session 创建时 fill | 之后用 `/thinking` 切 |
| `~/.kodax/config.json` → `customProviders[]` | ✅ runtime 已注册 | 启动期调 SDK `registerConfiguredCustomProviders`；用 `/provider <name>` 切。⚠️ 不在 Providers 面板显示 (schema 不兼容，面板复用 deferred v0.1.7+) |
| `~/.kodax/config.json` → `model` | ❌ 暂不读 | 跨 provider 时 model 名通常对不上；session 创建后用 `/model` 切 |
| `${projectRoot}/.kodax/config.json` → `mcpServers` | ✅ 自动加载 (Space parse) | SDK 不读项目级 config |
| `~/.kodax/AGENTS.md` + `${projectRoot}/AGENTS.md` | ✅ 自动加载 (SDK loadAgentsFiles) | 递归扫 cwd→root + .kodax/ |
| `~/.kodax/auto-rules.jsonc` + 项目级 | ✅ 自动加载 (SDK loadAutoRules) | auto 模式判定用 |
| `~/.kodax/sessions/` | ✅ 共享 (SDK /session) | KodaX CLI 跑过的 session 在 Space tree 出现 |
| **API Keys** | ⚠️ Space 这边配 | Space 用 OS keychain；启动前 `export ANTHROPIC_API_KEY=...` 走 env 也行 |
| `~/.kodax/commands/` (user commands) | ⚠️ 暂不复用 | 等 SlashCommandDef ↔ KodaXCommand 适配 (deferred v0.1.7+) |

> 注：`~/.kodax/config.json` 改动的 hot-reload 行为待 SDK 文档确认。若改完发现 Space 没拿到新值，重启 Space 兜底。

### 2.1 AGENTS.md 全自动

打开 Space 后直接点顶栏 "AGENTS.md" 弹窗就能看到当前 session 在用哪些 AGENTS.md。规则：

- `~/.kodax/AGENTS.md` 标 **global** scope (橙)
- `${projectRoot}/AGENTS.md` 标 **project** 或 **directory** scope (绿/蓝；SDK 用 directory 表示"递归扫到 projectRoot 顶上的那个")
- 改了 AGENTS.md 不用重启 Space — 下次打开 popout 就刷新

### 2.2 MCP servers 全自动 (global)

如果你在 KodaX CLI 用过 `kodax mcp add filesystem npx -y @modelcontextprotocol/server-filesystem`，那台机器上的 `~/.kodax/config.json` 已经有 mcpServers 段。Space 启动时直接从 SDK 读，不重复解析。

打开顶栏 "MCP" popout 就能看到列表。`source` 字段标 `global` 或 `project`，方便区分来源。

注：**只读展示**，不启动连接。完整的 启停 / 日志 / tool catalog 在 F039 (v0.1.7+) 做。

### 2.3 API Keys

Space 用 OS keychain (keytar) 存 key，跟 KodaX CLI 的 env 写法独立。**第一次启动**需要在设置面板填一次。流程：

1. 打开 "Providers" 面板（齿轮图标）
2. 选 provider (Anthropic / OpenAI / Kimi / Qwen / DeepSeek / Zhipu / 火山 Ark / Gemini / etc.)
3. 粘贴 API key → 点 "Test connection"
4. 成功后 Space 会把 key 注入 `process.env[apiKeyEnv]` (例如 `ANTHROPIC_API_KEY`)，KodaX SDK 从这里读

**安全契约**: key 永远不出 main 进程 — 不进 IPC push、不进 list 响应、不进错误 envelope、不进日志。

如果你想完全跳过 keychain，可以在启动 Space 之前自己 export 环境变量：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
npm run dev
```

Space 会优先用 env 已有值，不会覆盖。

### 2.4 Sessions 历史

SDK 0.7.42 的 `/session` 模块统一管理持久化。KodaX CLI 跑过的 session 在 Space 的"Sessions" tree 里直接出现，反过来也成立。Space F033 + F038 实现了：

- **List** — KodaX CLI session 在 Space tree 里
- **Fork** — 从历史 session 派生新 in-memory session
- **Rewind** — 回到历史中某条 assistant turn
- **Delete** — idempotent (REST DELETE 语义)

⚠️ 当前打开的 in-flight session 是 Space 的 in-memory 状态，不在 SDK 端落盘 — 是有意为之 (F033 split)，crash recovery 走 SDK 端的 partial-write checkpoint。

## 3. 第一次跑 — 5 分钟 walkthrough

1. `npm run dev`，等窗口起来
2. 在 chat 输入框点 "Select project root" → 选个项目目录 (要 absolute path；Space main 会 reject 非绝对路径，防 SSRF / 路径穿越)
3. 输入 `/provider`，看 KodaX CLI 已经配好的 provider 是否亮起（绿色 = 有 key；灰 = 缺 key）
4. 若灰：齿轮图标 → "Providers" → 填 key → Test
5. 回到 chat，发第一条 prompt
6. 想用工具？默认是 **plan** 模式（只读 / 分析类工具可用，写文件 / 跑命令需手动改）
   - `/mode default` — 默认；写工具会触发权限弹窗
   - `/mode auto` — 走 `auto-rules.jsonc` 自动判
   - `/mode plan` — 只读

## 4. v0.1.7 新功能速览

### 4.1 内置终端（多 tab）

右上 Toolbar 第 3 个图标 → 弹出真 PTY shell（不是工具日志 viewer，是真 `cmd.exe` / `zsh` / `bash`）。

- 顶栏 + 按钮新增 tab，最多 10 个；× 关 tab；点 tab 切换
- 每个 tab 自己的 shell 进程，切走不丢状态（运行中的 `npm run dev` 持续滚日志）
- 关闭 popout 不杀 PTY；关掉最后一个 tab 自动开新；要彻底关走 popout 顶栏 ×
- 跨平台：Win11 cmd.exe / Mac zsh / Linux bash
- Env 已剥所有 `*_KEY` `*_TOKEN`，shell 里 `echo $ANTHROPIC_API_KEY` 拿不到

### 4.2 ⌘Shift+P 命令面板（Win/Linux: Ctrl+Shift+P）

VS Code 同款 muscle memory，全局快捷键召出模糊搜索框。4 个分组：

| 分组 | 干啥 |
|--|--|
| **Actions** | New session / Toggle theme / Clear conversation view |
| **Sessions** | 当前项目最近 30 个 session（选中切过去） |
| **Files** | 项目下所有文件（选中在输入框插 `@path`） |
| **Slash** | 所有 slash 命令（选中插 `/cmd` 待执行） |

输入框模糊匹配，↑↓ 跨组导航，Enter 触发，Esc 关。

**⌘K vs ⌘Shift+P 区分**：
- **⌘K** = F018 Quick Ask（临时问一句，AI 不留 session 痕迹）
- **⌘Shift+P** = F026 Command Palette（导航 / 执行 / 插入）

### 4.3 文件富预览（PDF / docx / xlsx）

Preview popout（右上 Toolbar 第 1 个图标）输入文件路径自动按 ext 路由：

- `.pdf` → 单页 canvas 渲染 + 上下翻页（pdfjs-dist；50MB 上限）
- `.docx` → 简化 HTML（保留标题/段落/表格/链接，安全 sanitize；10MB 上限）
- `.xlsx` / `.xls` → 多 sheet tab + 单元格 table（50000 cell 上限；10MB 上限）
- 其它扩展名走原 Monaco 文本 viewer
- 超限文件给清晰错误提示，不会卡死 renderer

3 个 viewer 都是 **lazy 加载** — 不点开对应文件就不下载依赖；main bundle 不受影响。

## 5. Slash 命令清单 (v0.1.7 builtin)

| 命令 | 作用 |
|---|---|
| `/mode <default\|auto\|plan>` | 切权限模式 |
| `/auto-engine <local\|sdk\|hybrid>` | 控 auto 模式判定引擎 |
| `/provider <id>` | 切当前 session 的 provider |
| `/model <id\|default>` | 切模型；`default` 清掉 override 回 provider default |
| `/thinking <on\|off>` | 切 extended thinking |
| `/reasoning <effort>` | 控 reasoning depth (OpenAI 系列) |
| `/clear` | 清当前会话历史 |
| `/help` | 显示所有命令 |

除此之外 `/` 触发命令搜索 popover — F035 已经把 SDK skills 也合到这个 picker 里，可以同时搜内建命令 + skill。

## 6. 已知限制 (v0.1.7)

- **自定义 provider UI 不显示**: KodaX `customProviders[]` 已在 SDK runtime 注册（用 `/provider <name>` 切），但 Providers 面板没列出它们。原因：SDK shape 与 Space schema 不兼容，UI 同步需 schema breaking + 数据迁移 (deferred)
- **User commands**: KodaX `~/.kodax/commands/` 暂不在 Space 显示。需要适配 SlashCommandDef ↔ KodaXCommand 两个 shape (deferred)
- **MCP 启停**: v0.1.5 起已支持（F039 完整版），如不工作请检查 KodaX SDK 版本 ≥ 0.7.45
- **model 默认值不读 KodaX config**: 因为跨 provider 时 model 名通常对不上，session 创建后手动 `/model` 切。后续可能做 provider×model 映射
- **打包安装**: 不签名（KodaX Space 是自家工具不走公开 Beta）；OS 首启 Gatekeeper / SmartScreen 警告需手动 Open 接受
- **F015 Repointel warm API**: chip 显示 trace OK，但 standalone warm 入口未实现（留 v0.1.8）
- **F017 CLI ↔ Space teleport**: 没实现（等 KodaX SDK 暴露 session handoff API）
- **F018 Quick Ask 不完全符合 PRD**: 当前实现走临时 session + plan mode，PRD 期望 sideQuery API（不留任何痕迹）；留 v0.1.8 重做

## 7. 报问题

- Bug: GitHub Issues
- 安全相关: 不要走 issue；私下 contact
