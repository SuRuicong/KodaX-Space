// Shell env hydration — v0.1.6
//
// KodaX TUI 启动期会调 SDK `hydrateProcessEnvFromShell()`，让用户 .zshrc / .bashrc /
// $PROFILE 里 export 的 env (ARK_API_KEY / DEEPSEEK_API_KEY / KIMI_API_KEY 等)
// 流进 process.env。Space 之前没做，导致：
//   - shell-set 的 provider key 不被识别为 "configured"
//   - 默认 provider 选错（用户 KodaX config 写 'ark-coding'，但 ARK_API_KEY 不在 env →
//     Space fallback 到 anthropic）
//   - 用户感觉"我明明配了 key 怎么 Space 看不见"
//
// 修复：app.whenReady 早期调一次。dynamic import 命中 SDK subpath "import" 条件
// （CJS main 不能静态 import，详见 mcp/config-reader.ts 注释）。
//
// 失败容忍：hydrate 失败不阻塞启动 —— 用户仍能用 keychain 或在 shell 显式 export 后启动。

let hydrated = false;

/**
 * 启动期一次，把 user shell rc 里的 env 注入 process.env。
 * idempotent —— 多次调用只跑一次。
 *
 * **安全契约**：SDK 内部 spawn 用户 shell + 跑 `env` 命令 + parse。不写入 user
 * shell rc。process.env 注入后 KodaX SDK 自动 pick up。
 */
export async function hydrateShellEnvOnce(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const sdk = await import('@kodax-ai/kodax');
    const ok = sdk.hydrateProcessEnvFromShell();
    if (ok) {
      console.info('[shell-env-hydrate] OK — shell rc env merged into process.env');
    } else {
      // SDK 返回 false 通常说明检测不到 shell（罕见 / Windows 上常见）；不当错误处理
      console.info('[shell-env-hydrate] skipped — no shell available or hydration not applicable');
    }
  } catch (err) {
    console.warn(
      '[shell-env-hydrate] failed (non-fatal):',
      err instanceof Error ? err.message : err,
    );
  }
}
