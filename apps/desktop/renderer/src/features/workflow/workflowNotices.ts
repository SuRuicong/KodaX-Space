import type {
  WorkflowActivityPayload,
  WorkflowEventPayload,
  WorkflowProcessItemT,
  WorkflowRunT,
} from '@kodax-space/space-ipc-schema';

export interface WorkflowNoticeCandidate {
  readonly key: string;
  readonly text: string;
  readonly sentAt?: number;
}

const AGENT_SUMMARY_MAX = 900;
const ACTIVITY_MAX = 180;

export function compactWorkflowText(value: string | undefined, max = ACTIVITY_MAX): string {
  if (!value) return '';
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, Math.max(0, max - 1))}...`;
}

function workflowBlockText(value: string | undefined, max?: number): string {
  if (!value) return '';
  const text = value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (max === undefined) return text;
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 4)).trimEnd()}\n...`;
}

export function formatWorkflowActivityNotice(payload: WorkflowActivityPayload): string | null {
  const child = payload.childAgentName ?? payload.childAgentId ?? 'child agent';
  switch (payload.kind) {
    // Live per-tool activity (using X / X finished / completed) is shown in the
    // right-sidebar Workflow live panel; it must NOT flood the main transcript
    // during a run. Only the terminal agent `digest` (a meaningful summary) stays
    // in history — matching KodaX REPL's "live in the panel, digest in history".
    case 'tool_use':
    case 'tool_result':
    case 'end':
      return null;
    case 'digest': {
      const body = workflowBlockText(payload.summary, AGENT_SUMMARY_MAX);
      const verification = formatWorkflowVerification(payload.verification);
      if (!body && !verification) return null;
      const label =
        payload.summaryKind === 'digest-failed'
          ? 'agent summary excerpt'
          : payload.summaryKind === 'excerpt'
            ? 'agent excerpt'
            : 'agent summary';
      return `[workflow] ${label}: ${child}${body ? `\n${body}` : ''}${
        verification ? `\n${verification}` : ''
      }`;
    }
  }
}

function formatWorkflowVerification(
  verification: WorkflowActivityPayload['verification'],
): string {
  if (!verification) return '';
  const label = verification.ok ? 'verification passed' : 'verification failed';
  const mode = verification.enforcement ? ` (${verification.enforcement})` : '';
  const reasons = verification.reasons.length
    ? `: ${compactWorkflowText(verification.reasons.join('; '), AGENT_SUMMARY_MAX)}`
    : '';
  return `${label}${mode}${reasons}`;
}

export function formatWorkflowEventNotices(
  payload: WorkflowEventPayload,
): WorkflowNoticeCandidate[] {
  const notices: WorkflowNoticeCandidate[] = [];

  // Live run progress (agent spawned / phase started / artifact written / …) is
  // NOT pushed to the transcript — it belongs to the right-sidebar Workflow live
  // ticker. Only per-agent summaries + the final result land in history below.

  if (payload.type === 'workflow_updated' || payload.type === 'workflow_finished') {
    const fallbackSentAt = timestampFromIso(payload.snapshot.updatedAt);
    for (const item of payload.snapshot.items) {
      const summaryNotice = formatItemSummaryNotice(payload.snapshot.runId, item, fallbackSentAt);
      if (summaryNotice) notices.push(summaryNotice);
    }
  }

  if (payload.type === 'workflow_finished') {
    const finished = formatWorkflowFinishedNotice(payload);
    if (finished) notices.push(finished);
  }

  return notices;
}

export function formatWorkflowRunRestoreNotices(run: WorkflowRunT): WorkflowNoticeCandidate[] {
  const type =
    run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'
      ? 'workflow_finished'
      : 'workflow_updated';
  return formatWorkflowEventNotices({
    type,
    snapshot: run,
    ...(run.latestMessage !== undefined ? { message: run.latestMessage } : {}),
    ...(run.sessionId !== undefined ? { sessionId: run.sessionId } : {}),
    ...(run.surface !== undefined ? { surface: run.surface } : {}),
    ...(run.projectRoot !== undefined ? { projectRoot: run.projectRoot } : {}),
  });
}

function formatWorkflowFinishedNotice(
  payload: WorkflowEventPayload,
): WorkflowNoticeCandidate | null {
  const name = payload.snapshot.displayName ?? payload.snapshot.workflowName;
  const status = payload.snapshot.status;
  const detail = workflowBlockText(
    payload.snapshot.resultSummary ?? payload.snapshot.error ?? payload.message,
  );
  // Include the run id so a failed/completed notice is unambiguous when several runs
  // share the same workflow name. Users reported not being able to tell whether the
  // *currently running* workflow failed or a *previous* same-named run did (e.g. a
  // failed run fixed + rerun): the transcript notice now names the exact run.
  const runTag = payload.snapshot.runId;
  const text = `[workflow] ${status}: ${name} · ${runTag}${detail ? `\n${detail}` : ''}`;
  return {
    // Per-run+status key (no body fingerprint): a run finishes once, and if the terminal
    // notice is re-emitted (event replay / restore) it replaces in place instead of
    // duplicating. Distinct runIds keep distinct notices (same-name reruns stay separate).
    key: `finished:${payload.snapshot.runId}:${status}`,
    text,
    sentAt: timestampFromIso(payload.snapshot.updatedAt),
  };
}

function formatItemSummaryNotice(
  runId: string,
  item: WorkflowProcessItemT,
  fallbackSentAt?: number,
): WorkflowNoticeCandidate | null {
  if (item.kind !== 'agent') return null;

  const error = workflowBlockText(item.error, AGENT_SUMMARY_MAX);
  const summary =
    item.summaryStatus === 'result' || item.summaryStatus === 'notice'
      ? workflowBlockText(item.summary, AGENT_SUMMARY_MAX)
      : '';
  const body = error || summary;
  if (!body) return null;

  const title = item.title || item.agentId || item.childAgentId || item.id;
  const label = error || item.status === 'failed' ? 'agent failed' : 'agent summary';
  // Stable per-agent key: exactly ONE transcript notice per (run, item), replaced in
  // place as that agent's summary evolves (excerpt → result, status transitions). When
  // status/summaryStatus/body were part of the key, every evolution produced a NEW notice
  // — so the same agent's summary appeared multiple times (user report). appendWorkflowNotice
  // updates the existing keyed notice in place with the latest body instead of appending.
  return {
    key: `item:${runId}:${item.id}`,
    text: `[workflow] ${label}: ${title}\n${body}`,
    sentAt: timestampFromIso(item.endedAt ?? item.startedAt) ?? fallbackSentAt,
  };
}

function timestampFromIso(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
