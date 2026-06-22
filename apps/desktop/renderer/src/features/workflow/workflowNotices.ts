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
const PROGRESS_MAX = 260;

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
    case 'tool_use':
      return `[workflow] ${child}: using ${payload.toolName ?? 'tool'}`;
    case 'tool_result':
      return `[workflow] ${child}: ${payload.toolName ?? 'tool'} finished`;
    case 'end':
      return `[workflow] ${child}: completed`;
  }
}

export function formatWorkflowEventNotices(
  payload: WorkflowEventPayload,
): WorkflowNoticeCandidate[] {
  const notices: WorkflowNoticeCandidate[] = [];

  const progressNotice = formatWorkflowProgressNotice(payload);
  if (progressNotice) notices.push(progressNotice);

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

function formatWorkflowProgressNotice(
  payload: WorkflowEventPayload,
): WorkflowNoticeCandidate | null {
  if (payload.type !== 'workflow_updated') return null;
  const message = compactWorkflowText(payload.message, PROGRESS_MAX);
  if (!message || !isTranscriptProgressMessage(message)) return null;
  return {
    key: `progress:${payload.snapshot.runId}:${fingerprintText(message)}`,
    text: `[workflow] ${message}`,
    sentAt: timestampFromIso(payload.snapshot.updatedAt),
  };
}

function isTranscriptProgressMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.startsWith('agent spawned:') ||
    lower.startsWith('agent completed:') ||
    lower.startsWith('agent failed:') ||
    lower.startsWith('agent summary updated:') ||
    lower.startsWith('artifact written:') ||
    lower.startsWith('phase started:') ||
    lower.startsWith('phase completed:') ||
    lower.startsWith('workflow paused') ||
    lower.startsWith('workflow resumed')
  );
}

function formatWorkflowFinishedNotice(
  payload: WorkflowEventPayload,
): WorkflowNoticeCandidate | null {
  const name = payload.snapshot.displayName ?? payload.snapshot.workflowName;
  const status = payload.snapshot.status;
  const detail = workflowBlockText(
    payload.snapshot.resultSummary ?? payload.snapshot.error ?? payload.message,
  );
  const text = `[workflow] ${status}: ${name}${detail ? `\n${detail}` : ''}`;
  return {
    key: `finished:${payload.snapshot.runId}:${status}:${fingerprintText(detail)}`,
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
  const statusPart = `${item.status}:${item.summaryStatus ?? 'none'}`;
  return {
    key: `item:${runId}:${item.id}:${statusPart}:${fingerprintText(body)}`,
    text: `[workflow] ${label}: ${title}\n${body}`,
    sentAt: timestampFromIso(item.endedAt ?? item.startedAt) ?? fallbackSentAt,
  };
}

function timestampFromIso(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fingerprintText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
