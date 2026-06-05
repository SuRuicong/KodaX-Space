// Terminal (PTY) channels — FEATURE_011.
//
// 真 PTY 单 tab 终端，作为 F023 多 tab 的前置。Renderer ↔ main:
//   invoke: terminal.create / .write / .resize / .kill
//   push:   terminal.output / .exit
//
// Lifecycle:
//   1. Renderer 唤出 Terminal popout → 调 terminal.create(cwd, cols, rows)
//   2. Main 端 ptyHost spawn node-pty 子进程，分配 terminalId (uuid-v4)
//   3. PTY stdout 流 → push terminal.output 给 renderer，xterm.js write 入屏
//   4. 用户键入 → renderer 调 terminal.write(terminalId, data)
//   5. 调整窗口大小 → terminal.resize(terminalId, cols, rows)
//   6. 用户关 popout / kill PTY / app quit → terminal.kill；进程退出 push terminal.exit
//
// 安全：
//   - cwd 走 projectStore.assertAllowed（recent projects allowlist），防写到任意目录
//   - shell 由 main 端 per-platform 选择（cmd.exe / $SHELL），renderer 不允许指定，
//     避免 `--login` `-c "rm -rf /"` 类参数注入
//   - write data 上限 64 KB / 单次（防 renderer flood IPC channel）
//   - output 单 chunk 上限 64 KB（main 端切片），buffer 满时 backpressure
//   - cols/rows 上限 (1..500) — xterm.js 实际更小，500 是 sanity cap

import { z } from 'zod';

// ---- 公共约束 ----
const terminalIdSchema = z
  .string()
  .uuid({ message: 'terminalId must be a v4 UUID (generated server-side)' });

// 单次 write 上限 — 大段粘贴一般 < 16 KB，64 KB 给宽裕 buffer
const MAX_WRITE_BYTES = 65_536;
// PTY → renderer 单 chunk 上限（main 端切片）— xterm 处理 64 KB chunk 无压力
const MAX_OUTPUT_BYTES = 65_536;

const writeDataSchema = z
  .string()
  .max(MAX_WRITE_BYTES, { message: `data exceeds ${MAX_WRITE_BYTES} bytes` });

const colsSchema = z.number().int().min(1).max(500);
const rowsSchema = z.number().int().min(1).max(500);

// ---- Invoke: terminal.create ----
//
// cwd 必须是绝对路径 + projectStore.assertAllowed 通过。
// shell / env 不开放给 renderer 选择 — main 端按平台缺省（FEATURE_011 设计）。
export const terminalCreateChannel = {
  name: 'terminal.create',
  direction: 'invoke',
  input: z.object({
    cwd: z.string().min(1).max(4096),
    cols: colsSchema,
    rows: rowsSchema,
  }),
  output: z.object({
    terminalId: terminalIdSchema,
    /** Spawned shell program path — UI 显示用 `(bash)` `(cmd.exe)` 标签 */
    shell: z.string().min(1).max(512),
    /** PID 给排查用；renderer 不依赖它做任何决策 */
    pid: z.number().int().nonnegative(),
  }),
} as const;

// ---- Invoke: terminal.write ----
//
// 用户键入 / 粘贴 → ASCII 控制字符 / Unicode 都可走。Main 端原样 pty.write。
export const terminalWriteChannel = {
  name: 'terminal.write',
  direction: 'invoke',
  input: z.object({
    terminalId: terminalIdSchema,
    data: writeDataSchema,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Invoke: terminal.resize ----
//
// xterm.js + addon-fit 算出当前 viewport 的 cols/rows，throttle 后调过来。
export const terminalResizeChannel = {
  name: 'terminal.resize',
  direction: 'invoke',
  input: z.object({
    terminalId: terminalIdSchema,
    cols: colsSchema,
    rows: rowsSchema,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Invoke: terminal.kill ----
//
// Renderer 主动关 popout / 切 session 时调。Main 端 SIGTERM → SIGKILL escalate。
// 若 terminalId 已不存在（已 exit），返回 ok=true（idempotent）。
export const terminalKillChannel = {
  name: 'terminal.kill',
  direction: 'invoke',
  input: z.object({
    terminalId: terminalIdSchema,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Push: terminal.output ----
//
// PTY stdout 实时 push — chunk 大小由 main 端控制（max 64 KB）。
// xterm.write() 高吞吐设计可承接连续 push 不丢字。
export const terminalOutputChannel = {
  name: 'terminal.output',
  direction: 'push',
  payload: z.object({
    terminalId: terminalIdSchema,
    data: z.string().max(MAX_OUTPUT_BYTES),
  }),
} as const;

// ---- Push: terminal.exit ----
//
// PTY 子进程退出 — 不论 normal exit / signal / crash 都发一次。
// Renderer 收到后切 UI 到 "(exited)" 状态；用户可重开 popout 触发 terminal.create 新实例。
export const terminalExitChannel = {
  name: 'terminal.exit',
  direction: 'push',
  payload: z.object({
    terminalId: terminalIdSchema,
    exitCode: z.number().int().nullable(),
    signal: z.string().max(32).nullable(),
  }),
} as const;

export type TerminalCreateInput = z.infer<typeof terminalCreateChannel.input>;
export type TerminalCreateOutput = z.infer<typeof terminalCreateChannel.output>;
export type TerminalOutputPayload = z.infer<typeof terminalOutputChannel.payload>;
export type TerminalExitPayload = z.infer<typeof terminalExitChannel.payload>;
