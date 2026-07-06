# KodaX Space 用户说明书

适用版本：KodaX Space 0.1.27  
更新日期：2026-07-05  
适用对象：首次使用 KodaX Space 的开发者、技术团队成员、代码相关知识工作者。

## 1. 产品简介

KodaX Space 是 KodaX 的桌面客户端。它把 KodaX 的代码理解、对话、工具调用、权限确认、工作流、文件预览和本地知识能力放到一个图形化桌面工作台里。

你可以把它理解为一个本地优先的 AI Agent 工作台：

- 支持多个 LLM Provider，不锁定 Anthropic 或 OpenAI。
- 默认围绕本机项目目录工作，不把文件强制上传到云端服务。
- 可以打开项目、创建会话、审阅工具调用、查看 Diff、运行工作流。
- 支持图片粘贴、文件拖入、PDF/docx/xlsx 预览、内置终端和命令面板。
- 复用 KodaX CLI 的部分配置、MCP、AGENTS.md 和会话历史。

## 2. 安装与启动

### 2.1 下载安装包

从项目 Release 页面下载安装包：

<https://github.com/icetomoyo/KodaX-Space/releases/latest>

常见安装包：

| 系统    | 推荐包                                                                                   |
| ------- | ---------------------------------------------------------------------------------------- |
| Windows | `Setup.exe` 或 `Portable.exe`。如果浏览器拦截 `.exe`，下载 `Setup.zip` 或 `Portable.zip` |
| macOS   | `.dmg`                                                                                   |
| Linux   | `AppImage` 或 `.deb`                                                                     |

### 2.2 首次打开的系统提示

当前安装包未做公开发行签名，因此首次打开可能出现系统安全提示。

- Windows SmartScreen：点击“更多信息”，确认来源后选择“仍要运行”。
- macOS Gatekeeper：右键应用选择“打开”，或在系统设置的安全与隐私里允许打开。
- Linux：如使用 AppImage，可能需要先给文件添加可执行权限。

请只从可信来源获取安装包。若你是企业用户，请以团队内部发布渠道为准。

### 2.3 源码方式启动

如果你是内部测试或开发用户，也可以从源码启动：

```bash
git clone https://github.com/icetomoyo/KodaX-Space.git
cd KodaX-Space
npm install --include=dev
npm run dev
```

打开窗口后即可开始配置。

## 3. 5 分钟快速上手

按下面步骤完成第一次可用配置。

1. 打开 KodaX Space。
2. 选择界面语言：进入 `Settings` → `Preferences` → `Language`，选择 `简体中文`、`English` 或 `Follow system`。
3. 打开项目目录：在左侧项目区选择 `Open` 或输入框提示的 `Open a folder first`，选择一个本地项目目录。
4. 配置模型服务：进入 `Settings` → `Providers`，选择一个 Provider，填入 API Key，点击 `Test` 测试连接。
5. 设为默认 Provider：测试成功后，可点击 `Set default`。
6. 回到输入框，输入你的第一个任务，例如：

```text
请阅读这个项目的 README，并告诉我如何启动它。
```

发送后，KodaX Space 会自动创建会话，并在主界面显示 AI 回复、工具调用、工作进度和相关产物。

## 4. 核心概念

### 4.1 Project 项目

Project 是 KodaX Space 的工作目录。打开项目后，AI 才能围绕该目录读取文件、分析代码、生成修改建议或运行命令。

建议每次只打开你希望 AI 操作的项目根目录，避免把无关目录暴露给工具。

### 4.2 Session 会话

Session 是你和 AI 围绕一个项目进行的一段连续对话。会话会保留上下文、标题、工具调用记录和历史消息。

常见操作：

- 新建会话：发送第一条消息或使用 `/new`。
- 切换历史会话：在左侧 Sessions 列表点击。
- 复制、重命名、删除、Fork、Rewind：通过会话菜单或右键菜单操作。

### 4.3 Provider 与 Model

Provider 是模型服务商，例如 Anthropic、OpenAI、DeepSeek、Kimi、Qwen、Zhipu、Gemini CLI、Codex CLI 等。Model 是具体模型。

KodaX Space 支持内置 Provider，也支持添加自定义 Provider。自定义 Provider 可选择 OpenAI 兼容或 Anthropic 兼容协议，并配置 Base URL、默认模型和推理强度。

### 4.4 Permission Mode 权限模式

KodaX Space 有三种权限模式：

| 模式         | 适合场景                     | 行为                                   |
| ------------ | ---------------------------- | -------------------------------------- |
| Plan         | 只想让 AI 分析、计划、读文件 | 尽量只读，不直接写入文件               |
| Accept edits | 日常推荐                     | 涉及写文件、执行命令等操作时，由你确认 |
| Auto         | 熟悉项目和规则后使用         | 根据规则或模型判断自动放行部分操作     |

快捷方式：

- `Shift+Tab`：循环切换权限模式。
- `Ctrl+M`：打开权限模式选择器。
- `/mode plan`、`/mode accept-edits`、`/mode auto`：用命令切换。

### 4.5 Artifact 产物

Artifact 是 AI 生成的可查看成果，例如报告、HTML、图表、代码片段或交互式 HTML。产物会出现在右侧 Artifact 面板，也可能在对话中以可点击卡片显示。

### 4.6 Workflow 工作流

Workflow 用于多步骤任务，例如生成方案、拆解任务、复盘结果、管理长流程。当前 Workflow 入口在 Coder 面中使用，Partner 面暂不可用。

你可以通过 `/workflow` 查看和启动相关能力。

## 5. Provider 配置

### 5.1 添加 API Key

1. 打开 `Settings`。
2. 进入 `Providers`。
3. 找到要使用的 Provider。
4. 点击 `Add key` 或 `Update key`。
5. 粘贴 API Key。
6. 点击 `Save key`。
7. 点击 `Test`，确认连接成功。

API Key 会优先保存到系统 Keychain。Keychain 不可用时会退回内存模式，重启后可能需要重新配置。

### 5.2 使用环境变量

如果你不想在界面里保存 Key，也可以在启动 KodaX Space 前设置环境变量。例如：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

Windows PowerShell 示例：

```powershell
$env:OPENAI_API_KEY="sk-..."
npm run dev
```

界面会显示 Key 来源是 `env`。

### 5.3 添加自定义 Provider

在 `Settings` → `Providers` 中点击 `Add custom`，填写：

- Display name：显示名称。
- Protocol：OpenAI compatible 或 Anthropic compatible。
- Base URL：模型服务地址。
- Credential：API Key 或环境变量名。
- Default model：默认模型。
- Models：可选，多个模型用逗号分隔。
- Reasoning：可选，声明该 Provider 支持的推理强度。

只有在你明确信任内部网关时，才勾选跳过 Base URL 安全校验。

## 6. 日常使用

### 6.1 提问和执行任务

在底部输入框输入需求，按 `Enter` 发送。常见任务示例：

```text
阅读这个项目，告诉我主要模块和启动方式。
```

```text
帮我检查最近的改动有没有明显 bug，先不要修改文件。
```

```text
请修复登录页按钮样式错位的问题，并说明改了哪些文件。
```

如果 AI 需要写文件、运行命令或访问敏感工具，界面会弹出权限确认。

### 6.2 在运行中追加消息

如果当前会话正在运行，你仍然可以输入后续消息。KodaX Space 会把消息放入当前会话队列，等安全时机继续处理。

### 6.3 停止生成

当 AI 正在回复或运行任务时，发送按钮会变成停止按钮。你可以点击停止按钮，或按 `Esc` 发送停止信号。

### 6.4 引用项目文件

在输入框中输入 `@` 可以触发项目文件提示。选择文件后，输入框会插入类似：

```text
@src/main.ts
```

这适合让 AI 聚焦某个文件、目录或改动。

### 6.5 拖入文件

你可以把本地文件拖到输入框：

- 项目内文件会尽量插入 `@relative/path`。
- 项目外文件会插入 `file://` 链接。
- PNG/JPEG/WEBP 图片会作为图片输入一起发送。
- 每次草稿最多保留 32 个文件引用。

普通文件目前主要作为路径引用提供给 AI。结构化文件 Artifact 和视频输入仍属于后续能力。

### 6.6 粘贴截图或图片

在输入框直接粘贴 PNG/JPEG/WEBP 截图即可。图片会以缩略图显示在输入框上方，发送前可删除。

限制：

- 单张图片上限约 6 MiB。
- 单轮最多 8 张图片。
- GIF 动图目前不保证保留动画。

### 6.7 查看 Diff、Plan、Tasks

当 AI 生成计划、修改文件或启动子任务时，右侧面板可能自动展开：

- Plan：任务计划或待办。
- Diff：文件修改差异。
- Tasks：子任务或工作进度。

这个自动展开能力叫 Smart Popout Director，可在 `Settings` → `Preferences` 中关闭。

### 6.8 使用内置终端

点击右上工具栏的终端图标可打开内置终端。它是真实 PTY shell，不是日志查看器。

支持：

- 多 Tab。
- Windows 使用 `cmd.exe`。
- macOS 使用 `zsh`。
- Linux 使用 `bash`。

出于安全考虑，终端环境会剥离 `*_KEY`、`*_TOKEN` 等敏感变量。

### 6.9 预览文件

打开 Preview 面板后输入或选择文件路径，可预览：

| 文件类型         | 预览方式          |
| ---------------- | ----------------- |
| `.pdf`           | 单页渲染，可翻页  |
| `.docx`          | 简化 HTML 预览    |
| `.xlsx` / `.xls` | 多 Sheet 表格预览 |
| 其他文本文件     | Monaco 只读查看   |

超大文件会给出错误提示，不会卡死界面。

### 6.10 使用命令面板

快捷键：

- macOS：`⌘+Shift+P`
- Windows/Linux：`Ctrl+Shift+P`

命令面板可搜索：

- Actions：新建会话、切换主题、清空视图等。
- Sessions：切换最近会话。
- Files：插入项目文件引用。
- Slash：插入 Slash 命令。

### 6.11 Quick Ask 临时问答

快捷键：

- macOS：`⌘+K`
- Windows/Linux：`Ctrl+K`

Quick Ask 适合临时问一句，不想打断当前主会话时使用。回答有用时，可以选择 Continue in Coder，把它提升为正常 Coder 会话。

### 6.12 Slash 命令

在输入框输入 `/` 会打开命令提示。常用命令：

| 命令                                            | 作用                         |
| ----------------------------------------------- | ---------------------------- |
| `/help`                                         | 查看命令                     |
| `/new`                                          | 新建会话                     |
| `/clear`                                        | 清空当前会话视图             |
| `/provider <id>`                                | 切换当前会话 Provider        |
| `/model <id>`                                   | 切换模型                     |
| `/reasoning <off\|auto\|quick\|balanced\|deep>` | 设置推理深度                 |
| `/thinking <on\|off>`                           | 开关 thinking 输出           |
| `/mode <plan\|accept-edits\|auto>`              | 切换权限模式                 |
| `/workflow ...`                                 | 查看、创建、启动或管理工作流 |
| `/repointel status`                             | 查看仓库智能诊断状态         |
| `/repointel warm`                               | 对当前项目做最佳努力预热     |
| `/learn pending`                                | 查看学习建议                 |
| `/recover candidate`                            | 查看会话恢复候选             |
| `/extensions sdk`                               | 查看 SDK 扩展发现情况        |

不同版本和不同项目环境下，可用命令可能略有差异，以 `/help` 显示为准。

## 7. Workflow 工作流

### 7.1 什么时候使用 Workflow

适合使用 Workflow 的场景：

- 需要多步骤分析、执行、验证。
- 需要多个子任务协作。
- 需要保存、复用或重跑某类流程。
- 希望在右侧面板查看阶段、子步骤、结果和产物。

### 7.2 常用 Workflow 命令

```text
/workflow help
/workflow list
/workflow runs
/workflow show <runId>
/workflow create <你的任务描述>
/workflow stop
/workflow rerun <runId 或 savedName>
```

Workflow 结果会进入会话记录，也可能生成 Artifact。已完成的工作流在重启后会尽量恢复历史详情。

### 7.3 注意事项

- Workflow 当前只面向 Coder 面。
- Partner 面入口在 0.1.27 中是开发中状态，不能直接使用。
- Repo-intelligence / Repointel 能力受 License 状态控制。
- 有风险的工具调用仍会遵循权限模式和确认弹窗。

## 8. KodaX CLI 配置复用

如果你已经使用 KodaX CLI，Space 会自动复用部分配置。

| 配置                                          | Space 行为                   |
| --------------------------------------------- | ---------------------------- |
| `~/.kodax/config.json` 中的 `mcpServers`      | 自动加载到 MCP 面板          |
| `~/.kodax/config.json` 中的 `provider`        | 首次可作为默认 Provider 候选 |
| `~/.kodax/config.json` 中的 `permissionMode`  | 作为权限模式初始值           |
| `~/.kodax/config.json` 中的 `customProviders` | 自动注册为自定义 Provider    |
| `~/.kodax/AGENTS.md`                          | 自动加载                     |
| 项目内 `AGENTS.md`                            | 自动加载                     |
| `~/.kodax/sessions/`                          | 会话历史共享                 |

注意：

- API Key 通常需要在 Space 里配置一次，或通过环境变量传入。
- `~/.kodax/config.json` 修改后，如 Space 没有立刻识别，重启应用即可。
- KodaX 用户命令目录 `~/.kodax/commands/` 当前还不会完整显示在 Space 中。

## 9. License 与 Repo-intelligence

KodaX Space 支持离线 License 授权。社区、教育、研究和个人用途一般不会被要求导入 License。企业或托管部署可能需要导入 `.kodax-license` 文件。

查看或导入 License：

1. 打开 `Settings`。
2. 进入 `License`。
3. 查看当前状态。
4. 如团队提供了授权文件，点击 `Import` 导入。

Repo-intelligence / Repointel 属于受授权控制的能力。未授权或授权异常时，相关诊断、预热或仓库智能能力可能不可用。

## 10. 安全与隐私

KodaX Space 的默认原则是本地优先和显式授权。

- 项目文件默认在你的本机目录中读取和处理。
- API Key 不会通过 Renderer 状态、IPC 列表响应、错误消息或日志暴露。
- 写文件、运行命令等高风险操作会受权限模式控制。
- 打开项目目录时，Space 会校验路径，降低误读或路径穿越风险。
- 第三方 Provider 会收到你发送给模型的内容。请按你的团队数据规则选择 Provider 和模型。
- 终端会剥离常见敏感环境变量，降低 Key 泄漏风险。

## 11. 当前限制

以下限制适用于 0.1.27：

- Partner 面已包含底层代码、Sources 和 Knowledge Base 能力，但用户界面入口暂时置灰，等待产出链路补齐。
- Display Language 主要覆盖高频界面。模型回复、工具输出、部分专业面板仍可能显示英文。
- GIF、视频、普通文件结构化 Artifact 仍是后续能力。当前普通文件主要作为路径引用。
- Quick Ask 当前使用临时 plan-mode session，并非完全无 session 的 side query。
- 未签名安装包可能触发 SmartScreen 或 Gatekeeper。
- Workspace、Workflow、Repo-intelligence 的可用性可能受 SDK、License 和当前项目状态影响。

## 12. 常见问题

### 12.1 打不开应用，系统提示不安全

请确认安装包来源可信。Windows 可在 SmartScreen 中选择“更多信息”后继续运行；macOS 可右键应用选择“打开”。

### 12.2 Provider 显示 No key

进入 `Settings` → `Providers`，为对应 Provider 添加 API Key，或在启动前设置环境变量。

### 12.3 Test connection 失败

优先检查：

- API Key 是否正确。
- Provider 是否支持当前网络环境。
- 自定义 Provider 的 Base URL 和协议是否正确。
- 公司代理、防火墙或网关是否拦截。

### 12.4 AI 不能读取项目文件

确认你已经打开项目目录。输入框如果显示 `Open a folder first`，说明还没有项目上下文。

### 12.5 AI 修改文件前为什么弹确认

这是权限模式的安全设计。日常推荐使用 `Accept edits`，这样 AI 可以提出修改，但关键操作由你确认。

### 12.6 为什么 Partner 按钮不可点击

0.1.27 中 Partner 底层能力已预置，但交付物生成链路尚未完整开放，因此界面入口暂时显示“开发中”。

### 12.7 Workflow 看不到或无法启动

请检查：

- 当前是否在 Coder 面。
- 是否已打开项目目录。
- 当前会话是否属于当前项目。
- 如涉及 Repointel / repo-intelligence，License 是否有效。

### 12.8 粘贴图片失败

确认图片格式为 PNG/JPEG/WEBP，大小不超过限制。若是 GIF 或系统剪贴板没有给出图片文件，当前版本可能无法直接作为图片发送。

### 12.9 语言切换后仍有英文

这是当前版本的已知限制。菜单、Settings、侧栏和常用弹窗已支持中英切换，但模型输出、工具日志和部分专业面板可能仍保留英文。

## 13. 建议的第一次体验任务

你可以按顺序试用下面几类任务：

1. 项目理解：

```text
请阅读这个项目，给我一份模块结构和启动方式摘要。
```

2. 代码审查：

```text
请检查当前项目有没有明显的启动风险或配置问题，先不要修改文件。
```

3. 小修复：

```text
请修复一个你能确认的问题，修改前先说明计划。
```

4. 文档生成：

```text
请根据 README 和 package.json 生成一份开发者快速上手文档。
```

5. 图片理解：

粘贴一张截图后输入：

```text
请根据这张截图指出界面上的主要问题，并给出修改建议。
```

## 14. 获取帮助与反馈

- 普通问题或 Bug：提交 GitHub Issue。
- 安全相关问题：不要公开提交 Issue，请通过项目维护者指定的私下渠道反馈。
- 应用内帮助：按 `?` 打开快捷键与命令帮助，或输入 `/help` 查看命令。
