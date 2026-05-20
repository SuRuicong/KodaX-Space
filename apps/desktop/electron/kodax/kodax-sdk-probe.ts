// KodaX SDK shape probe — runs once at main process startup.
//
// 目的：把"SDK API 漂移"的失败点从"第一次 session.send 时崩"前移到"app 启动时崩"——
// 我们 ambient 声明 (kodax-sdk-types.d.ts) 写死了一组函数 / class，运行时若 SDK 升版本
// 把它们删/改了，TypeScript 不会报（ambient 覆盖了真实推导）。startup probe 拦住这种漂移。
//
// 已覆盖的 surface:
//   @kodax-ai/kodax/coding       runKodaX / createAutoModeToolGuardrail / loadAutoRules /
//                                formatAgentsForPrompt / getKodaxGlobalDir /
//                                getRegisteredToolDefinition / getBuiltinRegisteredToolDefinition /
//                                resolveProvider
//   @kodax-ai/kodax/skills       SkillRegistry (skill/registry.ts 自己也 probe，这里重复防御)
//
// 注意：runKodaX 故意从 /coding 子包 import 而非主入口 '@kodax-ai/kodax'——
// 主入口 SDK bundle 依赖 cli-boxes（package.json 走 JSON 但实际是 ESM），
// tsx/esm test runner 加载主入口会 SyntaxError；/coding 不走这条路径。
// 与 real-session.ts:19 的实际 import 保持一致即可。

import {
  createAutoModeToolGuardrail,
  formatAgentsForPrompt,
  getBuiltinRegisteredToolDefinition,
  getKodaxGlobalDir,
  getRegisteredToolDefinition,
  loadAutoRules,
  resolveProvider,
  runKodaX,
} from '@kodax-ai/kodax/coding';
import { SkillRegistry } from '@kodax-ai/kodax/skills';

interface ProbeEntry {
  readonly subpath: string;
  readonly name: string;
  readonly kind: 'function' | 'class';
  readonly value: unknown;
}

const PROBES: readonly ProbeEntry[] = [
  { subpath: '@kodax-ai/kodax/coding', name: 'runKodaX', kind: 'function', value: runKodaX },
  { subpath: '@kodax-ai/kodax/coding', name: 'createAutoModeToolGuardrail', kind: 'function', value: createAutoModeToolGuardrail },
  { subpath: '@kodax-ai/kodax/coding', name: 'formatAgentsForPrompt', kind: 'function', value: formatAgentsForPrompt },
  { subpath: '@kodax-ai/kodax/coding', name: 'getBuiltinRegisteredToolDefinition', kind: 'function', value: getBuiltinRegisteredToolDefinition },
  { subpath: '@kodax-ai/kodax/coding', name: 'getKodaxGlobalDir', kind: 'function', value: getKodaxGlobalDir },
  { subpath: '@kodax-ai/kodax/coding', name: 'getRegisteredToolDefinition', kind: 'function', value: getRegisteredToolDefinition },
  { subpath: '@kodax-ai/kodax/coding', name: 'loadAutoRules', kind: 'function', value: loadAutoRules },
  { subpath: '@kodax-ai/kodax/coding', name: 'resolveProvider', kind: 'function', value: resolveProvider },
  { subpath: '@kodax-ai/kodax/skills', name: 'SkillRegistry', kind: 'class', value: SkillRegistry },
];

/**
 * 一次性检查所有 SDK 入口可用。失败立即 throw —— main.ts 应当在 app.ready 之前调，
 * 让 Electron 启动失败比"用户发第一条 prompt 时白屏"更早被发现。
 */
export function probeKodaxSdk(): void {
  const failures: string[] = [];
  for (const probe of PROBES) {
    const actualKind = typeof probe.value;
    if (probe.kind === 'function' && actualKind !== 'function') {
      failures.push(`${probe.subpath} ${probe.name}: expected function, got ${actualKind}`);
    } else if (probe.kind === 'class' && actualKind !== 'function') {
      // class constructor 在 typeof 下也是 'function'
      failures.push(`${probe.subpath} ${probe.name}: expected class, got ${actualKind}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `[kodax-sdk-probe] KodaX SDK shape mismatch (update ` +
        `apps/desktop/electron/kodax/kodax-sdk-types.d.ts):\n  - ${failures.join('\n  - ')}`,
    );
  }
}
