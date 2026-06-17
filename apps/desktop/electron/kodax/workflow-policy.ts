// WorkflowPolicyStore (F064) — Space 侧的 Workflow Host Policy 持久化 + 智能默认 + 硬上限钳制。
//
// 对标 SDK 的 WorkflowHostPolicy（KodaXOptions.workflowHostPolicy）：
//   autoStart: 'off' | 'confirm' | 'on'  —— 自然语言触发 AMAW 自启的治理（默认 confirm）
//   maxAgents / maxConcurrency / tokenBudget —— 运行时上限（不得超 SDK 硬上限，也不绕子 agent 权限闸）
//
// 「极简且智能」：autoStart 默认 confirm（值得起工作流时确认一次再 fan-out，不静默吃大把 token）；
// caps 给保守默认、UI 折叠在「高级」，不当裸旋钮丢给用户。
//
// 持久化到 ~/.kodax/space/workflow-policy.json。real-session 在装配 KodaXOptions 时读 get()。

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getSpaceDataDir } from './data-paths.js';

export type WorkflowAutoStart = 'off' | 'confirm' | 'on';

export interface WorkflowPolicy {
  readonly autoStart: WorkflowAutoStart;
  readonly maxAgents: number;
  readonly maxConcurrency: number;
  readonly tokenBudget: number;
}

// SDK 硬上限（SYSTEM_WORKFLOW_LIMITS）——Space caps 不得超过；也是 clamp 上界。
const HARD = { maxAgents: 64, maxConcurrency: 16, tokenBudget: 200_000 } as const;

// 智能默认：保守（远低于硬上限），autoStart=confirm。
export const DEFAULT_WORKFLOW_POLICY: WorkflowPolicy = {
  autoStart: 'confirm',
  maxAgents: 16,
  maxConcurrency: 8,
  tokenBudget: 100_000,
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** 把任意输入收敛成合法 WorkflowPolicy（autoStart 闭集 + caps 钳到 [1, HARD]）。 */
export function normalizeWorkflowPolicy(
  input: Partial<WorkflowPolicy> | null | undefined,
): WorkflowPolicy {
  const autoStart: WorkflowAutoStart =
    input?.autoStart === 'off' || input?.autoStart === 'on' || input?.autoStart === 'confirm'
      ? input.autoStart
      : DEFAULT_WORKFLOW_POLICY.autoStart;
  return {
    autoStart,
    maxAgents: clampInt(input?.maxAgents, 1, HARD.maxAgents, DEFAULT_WORKFLOW_POLICY.maxAgents),
    maxConcurrency: clampInt(input?.maxConcurrency, 1, HARD.maxConcurrency, DEFAULT_WORKFLOW_POLICY.maxConcurrency),
    tokenBudget: clampInt(input?.tokenBudget, 1000, HARD.tokenBudget, DEFAULT_WORKFLOW_POLICY.tokenBudget),
  };
}

export class WorkflowPolicyStore {
  private cached: WorkflowPolicy = DEFAULT_WORKFLOW_POLICY;
  private loaded = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string = path.join(getSpaceDataDir(), 'workflow-policy.json')) {}

  /** 启动时加载一次（main.ts）。失败 / 缺文件 → 用默认。 */
  async load(): Promise<WorkflowPolicy> {
    if (this.loaded) return this.cached;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      this.cached = normalizeWorkflowPolicy(JSON.parse(raw) as Partial<WorkflowPolicy>);
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT')) {
        console.warn('[WorkflowPolicy] read failed, using defaults:', err instanceof Error ? err.message : err);
      }
      this.cached = DEFAULT_WORKFLOW_POLICY;
    }
    return this.cached;
  }

  /** 同步取当前策略（real-session 装配 options 时用；未 load 则返回默认）。 */
  get(): WorkflowPolicy {
    return this.cached;
  }

  /** 合并 patch（normalize + clamp）并持久化。返回生效后的策略。 */
  async set(patch: Partial<WorkflowPolicy>): Promise<WorkflowPolicy> {
    if (!this.loaded) await this.load();
    this.cached = normalizeWorkflowPolicy({ ...this.cached, ...patch });
    await this.persist();
    return this.cached;
  }

  private async persist(): Promise<void> {
    const prev = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((r) => {
      release = r;
    });
    await prev;
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = `${this.filePath}.tmp-${process.pid}`;
      await fs.writeFile(tmp, JSON.stringify(this.cached, null, 2), { encoding: 'utf-8', mode: 0o600 });
      try {
        await fs.rename(tmp, this.filePath);
      } catch (err) {
        const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
        if (code === 'EEXIST' || code === 'EPERM') {
          await fs.copyFile(tmp, this.filePath);
          await fs.unlink(tmp).catch(() => {});
        } else {
          await fs.unlink(tmp).catch(() => {});
          throw err;
        }
      }
    } catch (err) {
      console.warn('[WorkflowPolicy] persist failed:', err instanceof Error ? err.message : err);
    } finally {
      release();
    }
  }

  /** 等待 in-flight 写盘（测试用）。 */
  async flush(): Promise<void> {
    await this.writeLock;
  }
}

export const workflowPolicyStore = new WorkflowPolicyStore();
