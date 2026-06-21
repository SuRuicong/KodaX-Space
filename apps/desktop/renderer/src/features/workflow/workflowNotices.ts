import type {
  WorkflowActivityPayload,
  WorkflowEventPayload,
  WorkflowProcessItemT,
} from '@kodax-space/space-ipc-schema';

export interface WorkflowNoticeCandidate {
  readonly key: string;
  readonly text: string;
}

const FINAL_REPORT_MAX = 1400;
const AGENT_SUMMARY_MAX = 900;
const ACTIVITY_MAX = 180;
const PROGRESS_MAX = 260;

export function compactWorkflowText(value: string | undefined, max = ACTIVITY_MAX): string {
  if (!value) return '';
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, Math.max(0, max - 1))}...`;
}

function workflowBlockText(value: string | undefined, max: number): string {
  if (!value) return '';
  const text = value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
    for (const item of payload.snapshot.items) {
      const summaryNotice = formatItemSummaryNotice(payload.snapshot.runId, item);
      if (summaryNotice) notices.push(summaryNotice);
    }
  }

  if (payload.type === 'workflow_finished') {
    const finished = formatWorkflowFinishedNotice(payload);
    if (finished) notices.push(finished);
  }

  return notices;
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
    FINAL_REPORT_MAX,
  );
  const text = `[workflow] ${status}: ${name}${detail ? `\n${detail}` : ''}`;
  return {
    key: `finished:${payload.snapshot.runId}:${status}:${fingerprintText(detail)}`,
    text,
  };
}

function formatItemSummaryNotice(
  runId: string,
  item: WorkflowProcessItemT,
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
  };
}

function fingerprintText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
