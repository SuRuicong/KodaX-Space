// AskUserModal — FEATURE_032
//
// Shared UI for KodaX guardrail escalation and ask_user_question prompts.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AskUserRequestPayload, AskUserSignal, AskUserVerdict } from '@kodax-space/space-ipc-schema';
import { ASK_USER_BACK_SIGNAL } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';

const SEVERITY_STYLE: Record<AskUserSignal['severity'], string> = {
  info: 'bg-info/12 text-info',
  warning: 'bg-warn/12 text-warn',
  danger: 'bg-danger/12 text-danger',
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

type GuardrailPayload = Extract<AskUserRequestPayload, { toolCall: unknown }>;
type QuestionPayload = Extract<AskUserRequestPayload, { question: string }>;

function isGuardrail(payload: AskUserRequestPayload): payload is GuardrailPayload {
  return 'toolCall' in payload;
}

function isQuestion(payload: AskUserRequestPayload): payload is QuestionPayload {
  return 'question' in payload;
}

/** A multi-select is optional when the model explicitly sets min_selections:0. */
function isOptionalSelection(question: QuestionPayload): boolean {
  return question.multiSelect === true && question.minSelections === 0;
}

function selectionError(question: QuestionPayload, count: number): string | null {
  // Report the real minimum first (so a min>1 requirement doesn't degrade to the
  // generic "at least one" when submitted empty via the Enter shortcut).
  if (question.multiSelect && question.minSelections !== undefined && count < question.minSelections) {
    return `Choose at least ${question.minSelections} option${question.minSelections === 1 ? '' : 's'}.`;
  }
  // Empty is only an error when a selection is actually required. min_selections:0
  // marks a multi-select optional (FEATURE_222) — an empty submit is valid there.
  if (count === 0 && !isOptionalSelection(question)) return 'Choose at least one option.';
  if (question.multiSelect && question.maxSelections !== undefined && count > question.maxSelections) {
    return `Choose no more than ${question.maxSelections} option${question.maxSelections === 1 ? '' : 's'}.`;
  }
  return null;
}

function selectionHint(question: QuestionPayload | null): string | null {
  if (!question?.multiSelect) return null;
  const min = question.minSelections;
  const max = question.maxSelections;
  if (min === 0) return max !== undefined ? `Optional — choose up to ${max}.` : 'Optional — choose any that apply.';
  if (min !== undefined && max !== undefined) {
    if (min === max) return `Choose ${min}.`;
    return `Choose ${min}-${max}.`;
  }
  if (min !== undefined) return `Choose at least ${min}.`;
  if (max !== undefined) return `Choose up to ${max}.`;
  return null;
}

export function AskUserModal(): JSX.Element | null {
  const queue = useAppStore((s) => s.askUserQueue);
  const dequeue = useAppStore((s) => s.dequeueAskUser);
  const head = queue[0] ?? null;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [selectedValues, setSelectedValues] = useState<ReadonlySet<string>>(new Set());

  const guardrail = head && isGuardrail(head) ? head : null;
  const question = head && isQuestion(head) ? head : null;
  const kind = question ? question.kind : 'guardrail';

  useEffect(() => {
    setBusy(false);
    setErr(null);
    setInputValue(question && kind === 'input' ? question.default ?? '' : '');
    setSelectedValues(new Set(question && kind === 'select' && question.default ? [question.default] : []));
  }, [head?.reqId, kind, question]);

  const inputPreview = useMemo(() => {
    if (!guardrail?.toolCall.input) return null;
    try {
      return truncate(JSON.stringify(guardrail.toolCall.input, null, 2), 2000);
    } catch {
      return '[unserializable input]';
    }
  }, [guardrail]);

  const selectHint = useMemo(() => selectionHint(question), [question]);

  const reply = useCallback(
    async (
      payload: { verdict: AskUserVerdict } | { value: string | string[] } | { cancelled: true },
    ): Promise<void> => {
      if (!head || !window.kodaxSpace || busy) return;
      setBusy(true);
      setErr(null);
      try {
        const result = await window.kodaxSpace.invoke('askUser.reply', {
          reqId: head.reqId,
          ...payload,
        });
        if (!result.ok) {
          const code = result.error?.code ?? 'ERR_UNKNOWN';
          const message = result.error?.message ?? 'unknown error';
          setErr(`${code}: ${message}`);
          setBusy(false);
          return;
        }
        dequeue(head.reqId);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    },
    [head, busy, dequeue],
  );

  const answerGuardrail = useCallback(
    (verdict: AskUserVerdict): void => {
      void reply({ verdict });
    },
    [reply],
  );

  const submitQuestion = useCallback((): void => {
    if (!head || kind === 'guardrail') return;
    if (kind === 'input') {
      void reply({ value: inputValue });
      return;
    }
    if (!question) return;
    const values = [...selectedValues];
    const error = selectionError(question, values.length);
    if (error) {
      setErr(error);
      return;
    }
    void reply({ value: question.multiSelect ? values : values[0] ?? '' });
  }, [head, kind, inputValue, question, selectedValues, reply]);

  const cancelQuestion = useCallback((): void => {
    void reply({ cancelled: true });
  }, [reply]);

  useEffect(() => {
    if (!head) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (kind === 'guardrail') answerGuardrail('block');
        else cancelQuestion();
      } else if (e.key === 'Enter' && !busy && !(e.target instanceof HTMLTextAreaElement)) {
        if (kind === 'guardrail') answerGuardrail('allow');
        else submitQuestion();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [head, busy, kind, answerGuardrail, cancelQuestion, submitQuestion]);

  if (!head) return null;

  const hasDangerSignal = guardrail?.signals?.some((s) => s.severity === 'danger') ?? false;
  const borderClass = hasDangerSignal ? 'border-danger' : 'border-warn';
  const title = kind === 'guardrail'
    ? 'Agent needs your input'
    : kind === 'input'
      ? 'Answer question'
      : 'Choose an answer';

  const toggleOption = (value: string): void => {
    if (!question || kind !== 'select') return;
    if (value === ASK_USER_BACK_SIGNAL) {
      void reply({ value });
      return;
    }
    if (question.multiSelect) {
      const next = new Set(selectedValues);
      if (next.has(value)) next.delete(value);
      else {
        if (question.maxSelections !== undefined && next.size >= question.maxSelections) {
          setErr(`Choose no more than ${question.maxSelections} option${question.maxSelections === 1 ? '' : 's'}.`);
          return;
        }
        next.add(value);
      }
      setErr(null);
      setSelectedValues(next);
    } else {
      setErr(null);
      setSelectedValues(new Set([value]));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ask-user-modal-title"
    >
      <div
        className={`glass lift ix-zone w-[560px] max-w-[95vw] max-h-[90vh] flex flex-col bg-surface-2 border ${borderClass} rounded-lg`}
      >
        <div className="px-5 py-3 border-b border-border-default flex items-center gap-3 flex-shrink-0">
          <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded bg-warn/15 text-warn">
            ASK
          </span>
          <h2 id="ask-user-modal-title" className="text-sm font-semibold text-fg-primary">
            {title}
          </h2>
          {queue.length > 1 && (
            <span className="ml-auto text-[11px] font-mono text-fg-muted">
              +{queue.length - 1} pending
            </span>
          )}
        </div>

        <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
          {guardrail ? (
            <>
              <div className="text-sm text-fg-primary leading-relaxed whitespace-pre-wrap">
                {truncate(guardrail.reason, 1500)}
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-mono uppercase text-fg-muted">Tool</div>
                <div className="text-sm font-mono text-warn">{guardrail.toolCall.toolName}</div>
              </div>

              {inputPreview && (
                <div className="space-y-1">
                  <div className="text-[11px] font-mono uppercase text-fg-muted">Input</div>
                  <pre className="text-xs font-mono bg-surface border border-border-default rounded p-2 overflow-x-auto max-h-48">
                    {inputPreview}
                  </pre>
                </div>
              )}

              {guardrail.signals && guardrail.signals.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] font-mono uppercase text-fg-muted">Signals</div>
                  <div className="flex flex-wrap gap-1">
                    {guardrail.signals.map((sig, idx) => (
                      <span
                        key={`${sig.type}-${idx}`}
                        className={`text-[11px] px-2 py-0.5 rounded font-mono ${SEVERITY_STYLE[sig.severity]}`}
                        title={sig.message}
                      >
                        {sig.type}
                      </span>
                    ))}
                  </div>
                  {guardrail.signals.map((sig, idx) => (
                    <div key={`msg-${sig.type}-${idx}`} className="text-xs text-fg-muted pl-2">
                      · {truncate(sig.message, 200)}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {question?.header && (
                <div className="text-[11px] font-mono uppercase text-fg-muted">{truncate(question.header, 96)}</div>
              )}
              <div className="text-sm text-fg-primary leading-relaxed whitespace-pre-wrap">
                {question ? truncate(question.question, 1500) : ''}
              </div>
              {selectHint && kind === 'select' && (
                <div className="text-xs text-fg-muted">{selectHint}</div>
              )}
              {kind === 'input' ? (
                <textarea
                  autoFocus
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="w-full min-h-24 resize-y rounded border border-border-default bg-surface px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent"
                />
              ) : (
                <div className="space-y-2">
                  {question?.options?.map((option) => {
                    const selected = selectedValues.has(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={busy}
                        onClick={() => toggleOption(option.value)}
                        className={`w-full text-left rounded border px-3 py-2 transition ${
                          selected
                            ? 'border-ok bg-ok/12 text-fg-primary'
                            : 'border-border-default bg-surface hover:bg-hover-bg text-fg-primary'
                        } disabled:opacity-50`}
                      >
                        <div className="flex items-center gap-2">
                          {question.multiSelect && (
                            <span
                              className={`h-3.5 w-3.5 rounded-sm border ${
                                selected ? 'bg-ok border-ok' : 'border-fg-muted'
                              }`}
                            />
                          )}
                          {!question.multiSelect && (
                            <span
                              className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                                selected ? 'border-ok' : 'border-fg-muted'
                              }`}
                            >
                              {selected && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
                            </span>
                          )}
                          <span className="text-sm font-medium">{truncate(option.label, 160)}</span>
                        </div>
                        {option.description && (
                          <div className="mt-1 text-xs text-fg-muted">{truncate(option.description, 300)}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {err && <div className="text-xs text-danger font-mono">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-border-default flex items-center justify-end gap-2 flex-shrink-0">
          {kind === 'guardrail' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => answerGuardrail('block')}
                className="px-3 py-1.5 text-xs rounded bg-surface-3 text-fg-primary hover:bg-hover-bg disabled:opacity-50"
              >
                Block (Esc)
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => answerGuardrail('allow')}
                className="px-3 py-1.5 text-xs rounded font-medium bg-ok/15 text-ok border border-ok/50 hover:bg-ok/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Allow (Enter)
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={cancelQuestion}
                className="px-3 py-1.5 text-xs rounded bg-surface-3 text-fg-primary hover:bg-hover-bg disabled:opacity-50"
              >
                Cancel (Esc)
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  (kind === 'select' &&
                    selectedValues.size === 0 &&
                    !(question ? isOptionalSelection(question) : false))
                }
                onClick={submitQuestion}
                className="px-3 py-1.5 text-xs rounded font-medium bg-ok/15 text-ok border border-ok/50 hover:bg-ok/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
