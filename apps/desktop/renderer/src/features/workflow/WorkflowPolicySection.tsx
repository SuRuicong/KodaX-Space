// F064 — Workflow Host Policy 设置节（挂在 Settings › Preferences）。
//
// autoStart 三档（off / confirm / on，默认 confirm）治理自然语言 AMAW 自启：
//   - confirm（默认）：识别到值得起工作流时确认一次再 fan-out，不静默吃大把 token
//   - on：透明自启   - off：禁 AMAW 自启（仍可从库显式启动）
// caps 折叠在「高级」——智能默认、不当裸旋钮；main 侧已 clamp 到 SDK 硬上限。

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { WorkflowPolicyT } from '@kodax-space/space-ipc-schema';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';

const AUTOSTART_OPTS: {
  value: WorkflowPolicyT['autoStart'];
  labelKey: MessageKey;
  hintKey: MessageKey;
}[] = [
  {
    value: 'off',
    labelKey: 'workflow.autoStart.off',
    hintKey: 'workflow.autoStart.off.hint',
  },
  {
    value: 'confirm',
    labelKey: 'workflow.autoStart.confirm',
    hintKey: 'workflow.autoStart.confirm.hint',
  },
  {
    value: 'on',
    labelKey: 'workflow.autoStart.on',
    hintKey: 'workflow.autoStart.on.hint',
  },
];

export function WorkflowPolicySection(): JSX.Element {
  const { t } = useI18n();
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
    <section className="space-y-3">
      <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-muted">
        {t('workflow.autoStart.title')}
      </label>
      <div className="inline-flex overflow-hidden rounded-lg border border-border-default bg-surface">
        {AUTOSTART_OPTS.map((o) => {
          const active = policy?.autoStart === o.value;
          const hint = t(o.hintKey);
          return (
            <button
              key={o.value}
              type="button"
              title={hint}
              aria-pressed={active}
              disabled={!policy}
              onClick={() => void patch({ autoStart: o.value })}
              className={`px-3 py-1.5 text-xs ${
                active ? 'bg-accent/20 text-accent' : 'text-fg-secondary hover:bg-surface-3'
              }`}
            >
              {t(o.labelKey)}
            </button>
          );
        })}
      </div>
      <div className="text-xs leading-5 text-fg-muted">
        {policy
          ? t(AUTOSTART_OPTS.find((o) => o.value === policy.autoStart)?.hintKey ?? 'workflow.policy.hint')
          : t('workflow.policy.hint')}
      </div>

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
        className="h-8 w-32 rounded-lg border border-border-default bg-surface px-2 text-fg-primary font-mono focus:outline-none focus:border-border-strong"
      />
      <span className="text-[10px] text-fg-faint">&lt;= {max}</span>
    </div>
  );
}
