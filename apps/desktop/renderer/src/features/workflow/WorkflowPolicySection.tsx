import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { WorkflowPolicyT } from '@kodax-space/space-ipc-schema';
import { useI18n } from '../../i18n/I18nProvider.js';

export function WorkflowPolicySection(): JSX.Element {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<WorkflowPolicyT | null>(null);
  const [advanced, setAdvanced] = useState(true);

  useEffect(() => {
    void window.kodaxSpace?.invoke('workflow.policy.get', undefined).then((r) => {
      if (r?.ok) setPolicy(r.data);
    });
  }, []);

  async function patch(p: Partial<WorkflowPolicyT>): Promise<void> {
    const r = await window.kodaxSpace?.invoke('workflow.policy.set', p).catch(() => null);
    if (r?.ok) setPolicy(r.data);
  }

  return (
    <section className="space-y-3">
      <div className="text-xs leading-5 text-fg-muted">{t('workflow.policy.hint')}</div>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        aria-expanded={advanced}
        className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg-primary"
      >
        {advanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t('workflow.advancedLimits')}
      </button>
      {advanced && policy && (
        <div className="space-y-2 rounded-lg border border-border-default bg-surface px-3 py-3">
          <CapInput
            label={t('workflow.maxAgents')}
            value={policy.maxAgents}
            max={64}
            onCommit={(v) => void patch({ maxAgents: v })}
          />
          <CapInput
            label={t('workflow.maxConcurrency')}
            value={policy.maxConcurrency}
            max={16}
            onCommit={(v) => void patch({ maxConcurrency: v })}
          />
          <CapInput
            label={t('workflow.tokenBudget')}
            value={policy.tokenBudget}
            max={200000}
            step={10000}
            onCommit={(v) => void patch({ tokenBudget: v })}
          />
          <div className="text-[10px] text-fg-faint">{t('workflow.limitsHint')}</div>
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
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="w-32 text-fg-secondary">{label}</span>
      <input
        type="number"
        min={1}
        max={max}
        step={step ?? 1}
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="h-8 w-32 rounded-lg border border-border-default bg-surface px-2 font-mono text-fg-primary focus:border-border-strong focus:outline-none"
      />
      <span className="text-[10px] text-fg-faint">&lt;= {max}</span>
    </div>
  );
}
