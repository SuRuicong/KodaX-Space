// F064 — Workflow Host Policy 设置节（挂在 Settings › Preferences）。
//
// autoStart 三档（off / confirm / on，默认 confirm）治理自然语言 AMAW 自启：
//   - confirm（默认）：识别到值得起工作流时确认一次再 fan-out，不静默吃大把 token
//   - on：透明自启   - off：禁 AMAW 自启（仍可从库显式启动）
// caps 折叠在「高级」——智能默认、不当裸旋钮；main 侧已 clamp 到 SDK 硬上限。

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { WorkflowPolicyT } from '@kodax-space/space-ipc-schema';

const AUTOSTART_OPTS: { value: WorkflowPolicyT['autoStart']; label: string; hint: string }[] = [
  { value: 'off', label: '关', hint: '禁自然语言自启（仍可显式启动）' },
  { value: 'confirm', label: '确认', hint: '自启前确认一次（推荐）' },
  { value: 'on', label: '自动', hint: '透明自启，不确认' },
];

export function WorkflowPolicySection(): JSX.Element {
  const [policy, setPolicy] = useState<WorkflowPolicyT | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    void window.kodaxSpace?.invoke('workflow.policy.get', undefined).then((r) => {
      if (r?.ok) setPolicy(r.data);
    });
  }, []);

  async function patch(p: Partial<WorkflowPolicyT>): Promise<void> {
    const r = await window.kodaxSpace?.invoke('workflow.policy.set', p).catch(() => null);
    if (r?.ok) setPolicy(r.data); // 回写 main 侧 normalize + clamp 后的值
  }

  return (
    <section className="pt-3 border-t border-border-default">
      <label className="block text-[11px] text-fg-muted uppercase tracking-wider mb-1.5">
        Workflow 自启
      </label>
      <div className="inline-flex rounded border border-border-default overflow-hidden">
        {AUTOSTART_OPTS.map((o) => {
          const active = policy?.autoStart === o.value;
          return (
            <button
              key={o.value}
              type="button"
              title={o.hint}
              disabled={!policy}
              onClick={() => void patch({ autoStart: o.value })}
              className={`px-3 py-1 text-xs ${
                active ? 'bg-accent/20 text-accent' : 'text-fg-secondary hover:bg-surface-3'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <div className="text-[11px] text-fg-muted mt-1">
        {AUTOSTART_OPTS.find((o) => o.value === policy?.autoStart)?.hint ??
          '自然语言触发多 agent 工作流的策略。'}
      </div>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg-primary"
      >
        {advanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        高级（运行上限）
      </button>
      {advanced && policy && (
        <div className="mt-1.5 space-y-1.5 pl-1">
          <CapInput
            label="最大 agent 数"
            value={policy.maxAgents}
            max={64}
            onCommit={(v) => void patch({ maxAgents: v })}
          />
          <CapInput
            label="最大并发"
            value={policy.maxConcurrency}
            max={16}
            onCommit={(v) => void patch({ maxConcurrency: v })}
          />
          <CapInput
            label="token 预算"
            value={policy.tokenBudget}
            max={200000}
            step={10000}
            onCommit={(v) => void patch({ tokenBudget: v })}
          />
          <div className="text-[10px] text-fg-faint">上限不可超过 KodaX 硬上限（64 / 16 / 200k）。</div>
        </div>
      )}
    </section>
  );
}

function CapInput({
  label,
  value,
  max,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  max: number;
  step?: number;
  onCommit: (v: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  function commit(): void {
    const n = Number(draft);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setDraft(String(value));
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-fg-secondary w-24">{label}</span>
      <input
        type="number"
        min={1}
        max={max}
        step={step ?? 1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-28 bg-surface border border-border-default rounded px-2 py-0.5 text-fg-primary font-mono focus:outline-none focus:border-border-strong"
      />
      <span className="text-[10px] text-fg-faint">≤ {max}</span>
    </div>
  );
}
