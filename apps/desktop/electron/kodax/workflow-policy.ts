// WorkflowPolicyStore (F064): host-owned workflow runtime limits.
//
// KodaX 0.7.58 removed host-side natural-language workflow auto-start.
// AMAW may choose run_workflow from the model layer; /workflow remains the
// explicit command path. Space therefore persists only runtime ceilings here.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getSpaceDataDir } from './data-paths.js';

export interface WorkflowPolicy {
  readonly maxAgents: number;
  readonly maxConcurrency: number;
  /** Per-run token cap. **0 = unlimited (no cap)** — the default. Matches KodaX,
   * which imposes no token budget on a workflow; only an explicit user value caps. */
  readonly tokenBudget: number;
}

// tokenBudget HARD only bounds an EXPLICIT user-set cap; 0 (unlimited) is the default.
const HARD = { maxAgents: 64, maxConcurrency: 16, tokenBudget: 100_000_000 } as const;

export const DEFAULT_WORKFLOW_POLICY: WorkflowPolicy = {
  maxAgents: 16,
  maxConcurrency: 8,
  // No token cap by default — a real workflow (e.g. a deep parallel review) easily
  // exceeds a low fixed budget, and the SDK/KodaX itself imposes none. Users can opt
  // into a cap via the Workflow policy settings; 0 = unlimited.
  tokenBudget: 0,
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** 0 / negative / non-number → 0 (unlimited); otherwise a sane explicit cap. */
function normalizeTokenBudget(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return Math.min(HARD.tokenBudget, Math.max(10_000, Math.round(v)));
}

/** Normalize arbitrary persisted/user input into the SDK WorkflowHostPolicy subset. */
export function normalizeWorkflowPolicy(
  input: Partial<WorkflowPolicy> | null | undefined,
): WorkflowPolicy {
  return {
    maxAgents: clampInt(input?.maxAgents, 1, HARD.maxAgents, DEFAULT_WORKFLOW_POLICY.maxAgents),
    maxConcurrency: clampInt(
      input?.maxConcurrency,
      1,
      HARD.maxConcurrency,
      DEFAULT_WORKFLOW_POLICY.maxConcurrency,
    ),
    tokenBudget: normalizeTokenBudget(input?.tokenBudget),
  };
}

export class WorkflowPolicyStore {
  private cached: WorkflowPolicy = DEFAULT_WORKFLOW_POLICY;
  private loaded = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = path.join(getSpaceDataDir(), 'workflow-policy.json'),
  ) {}

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

  get(): WorkflowPolicy {
    return this.cached;
  }

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
      await fs.writeFile(tmp, JSON.stringify(this.cached, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
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

  async flush(): Promise<void> {
    await this.writeLock;
  }
}

export const workflowPolicyStore = new WorkflowPolicyStore();
