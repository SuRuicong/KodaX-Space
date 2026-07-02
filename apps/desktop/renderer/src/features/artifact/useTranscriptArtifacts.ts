import { useAppStore } from '../../store/appStore';
import { type TransientArtifactSnapshot } from './transientArtifact';

const EMPTY_TRANSCRIPT_ARTIFACTS: readonly TransientArtifactSnapshot[] = [];

/**
 * Transient (transcript-only) artifacts for a session. Reads the store's derived
 * `transientArtifactsBySession` table, which the appendEvent reducer maintains
 * incrementally on `create_artifact` tool results. Subscribing here (instead of
 * to raw `eventsBySession`) means always-mounted consumers like RightSidebar do
 * NOT re-scan the whole event log on every streamed text_delta — the selected
 * reference only changes when an artifact is actually minted or buffers reset.
 */
export function useTranscriptArtifacts(
  sessionId: string | null,
): readonly TransientArtifactSnapshot[] {
  return useAppStore((s) =>
    sessionId ? s.transientArtifactsBySession[sessionId] ?? EMPTY_TRANSCRIPT_ARTIFACTS : EMPTY_TRANSCRIPT_ARTIFACTS,
  );
}
