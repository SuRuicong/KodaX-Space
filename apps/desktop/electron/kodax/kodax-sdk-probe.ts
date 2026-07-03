// KodaX SDK shape probe — runs once at main process startup.
//
// 目的：把"SDK API 漂移"的失败点从"第一次 session.send 时崩"前移到"app 启动时崩"——
// 我们 ambient 声明 (kodax-sdk-types.d.ts) 写死了一组函数 / class，运行时若 SDK 升版本
// 把它们删/改了，TypeScript 不会报（ambient 覆盖了真实推导）。startup probe 拦住这种漂移。
//
// 已覆盖的 surface:
//   @kodax-ai/kodax/coding       runKodaX / runManagedTask / createAutoModeToolGuardrail / loadAutoRules /
//                                formatAgentsForPrompt / getKodaxGlobalDir /
//                                getRegisteredToolDefinition / getBuiltinRegisteredToolDefinition /
//                                resolveProvider
//   @kodax-ai/kodax/skills       SkillRegistry (skill/registry.ts 自己也 probe，这里重复防御)
//   @kodax-ai/kodax/llm          verifyProviderCredential (FEATURE_216 — 测连接)
//
// **静态 import 改 dynamic**：SDK subpath exports 只声明 "import" 条件（ESM），CJS-built
// main 进程的静态 require 会撞 ERR_PACKAGE_PATH_NOT_EXPORTED。dynamic import 走 ESM 解析
// 命中 "import" 条件正常工作。probe 改为 async — main.ts 在 app.whenReady().then 内调，
// 已是 async 上下文。

/**
 * 一次性检查所有 SDK 入口可用。失败立即 throw —— main.ts 应当在 app.ready 之前调，
 * 让 Electron 启动失败比"用户发第一条 prompt 时白屏"更早被发现。
 */
export async function probeKodaxSdk(): Promise<void> {
  const failures: string[] = [];

  const codingModule = await import('@kodax-ai/kodax/coding');
  const codingChecks: ReadonlyArray<readonly [string, 'function' | 'class', unknown]> = [
    ['runKodaX', 'function', codingModule.runKodaX],
    ['runManagedTask', 'function', codingModule.runManagedTask],
    ['createAutoModeToolGuardrail', 'function', codingModule.createAutoModeToolGuardrail],
    ['formatAgentsForPrompt', 'function', codingModule.formatAgentsForPrompt],
    ['getBuiltinRegisteredToolDefinition', 'function', codingModule.getBuiltinRegisteredToolDefinition],
    ['getKodaxGlobalDir', 'function', codingModule.getKodaxGlobalDir],
    ['getRegisteredToolDefinition', 'function', codingModule.getRegisteredToolDefinition],
    ['isToolNetworkRead', 'function', codingModule.isToolNetworkRead],
    ['loadAutoRules', 'function', codingModule.loadAutoRules],
    ['resolveProvider', 'function', codingModule.resolveProvider],
  ];
  for (const [name, kind, value] of codingChecks) {
    const actualKind = typeof value;
    // class constructor 在 typeof 下也是 'function'
    if (actualKind !== 'function') {
      failures.push(`@kodax-ai/kodax/coding ${name}: expected ${kind}, got ${actualKind}`);
    }
  }

  const skillsModule = await import('@kodax-ai/kodax/skills');
  if (typeof skillsModule.SkillRegistry !== 'function') {
    failures.push(
      `@kodax-ai/kodax/skills SkillRegistry: expected class, got ${typeof skillsModule.SkillRegistry}`,
    );
  }

  // /llm：测连接走 verifyProviderCredential（FEATURE_216）。
  // v0.1.4 修复：之前作 hard failure 抛错，但 npm-published @kodax-ai/kodax@0.7.45
  // 还没合 FEATURE_216 commit（本地 `npm run link:kodax` 时有，CI npm install 时没有）。
  // 让 release pipeline 全平台死。降级成 console.warn — 缺失时 test-connection.ts
  // 走 fallback 返回 "SDK 不支持此功能"，UI 仍能用。
  const llmModule = await import('@kodax-ai/kodax/llm');
  if (typeof llmModule.resolveModelCapabilities !== 'function') {
    failures.push(
      `@kodax-ai/kodax/llm.resolveModelCapabilities: expected function, got ${typeof llmModule.resolveModelCapabilities}`,
    );
  }
  if (typeof llmModule.verifyProviderCredential !== 'function') {
    console.warn(
      '[kodax-sdk-probe] @kodax-ai/kodax/llm.verifyProviderCredential not present in this SDK build. ' +
      'Provider connection test will be disabled until the SDK is upgraded.',
    );
  }

  // /agent：context-window 显示 (provider.modelContextWindow channel) 依赖 resolveContextWindow —
  // 它是 runtime compaction 与 UI 显示的单一事实源。SDK 删/改它会让上下文窗口静默退回 200k 兜底,
  // 所以在启动 probe 里硬拦。
  const agentModule = await import('@kodax-ai/kodax/agent');
  if (typeof agentModule.resolveContextWindow !== 'function') {
    failures.push(
      `@kodax-ai/kodax/agent.resolveContextWindow: expected function, got ${typeof agentModule.resolveContextWindow}`,
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `[kodax-sdk-probe] KodaX SDK shape mismatch (update ` +
        `apps/desktop/electron/kodax/kodax-sdk-types.d.ts):\n  - ${failures.join('\n  - ')}`,
    );
  }
}
