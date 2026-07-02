import { canonProjectRoot } from '@kodax-space/space-ipc-schema';
import type { FileNodeT } from '@kodax-space/space-ipc-schema';
import { projectStore } from '../projects/store.js';
import {
  resolveInsideProject,
  readFileWithGuards,
  walkTree,
} from '../ipc/files-core.js';
import {
  resolveSessionRunContext,
  type SdkToolExecutionContextLike,
} from './session-run-context.js';
import { registerPartnerSpaceToolPolicy } from './partner-tools.js';
import { partnerSourceStore, type PartnerSourceStore } from './partner-source-store.js';

const MAX_TOOL_RESULT_CHARS = 180_000;

const DESCRIPTION = [
  'Read one Partner source that the user attached to the current Partner session.',
  'Use this before making source-dependent claims. Pass the exact sourceId from the Partner source list.',
  'For file sources this returns UTF-8 text when available. For directory sources this returns a bounded tree.',
  'The tool is read-only and cannot read paths outside the registered source/project boundary.',
].join('\n');

export const PARTNER_SOURCE_READ_TOOL = {
  name: 'partner_source_read',
  description: DESCRIPTION,
  sideEffect: 'readonly' as const,
  input_schema: {
    type: 'object' as const,
    properties: {
      sourceId: {
        type: 'string',
        description: 'The id of a source attached to the current Partner session.',
      },
    },
    required: ['sourceId'],
  },
};

interface PartnerSourceReadDeps {
  readonly store: PartnerSourceStore;
  readonly assertAllowedProjectRoot?: (projectRoot: string) => Promise<string>;
}

type ToolHandler = (
  input: Record<string, unknown>,
  context?: SdkToolExecutionContextLike,
) => Promise<string>;

function capToolResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[partner_source_read truncated at ${MAX_TOOL_RESULT_CHARS} chars]`;
}

function renderTree(nodes: readonly FileNodeT[], depth = 0): string[] {
  const lines: string[] = [];
  const prefix = '  '.repeat(depth);
  for (const node of nodes) {
    lines.push(`${prefix}- ${node.kind === 'dir' ? '[dir]' : '[file]'} ${node.path}`);
    if (node.children && node.children.length > 0) {
      lines.push(...renderTree(node.children, depth + 1));
    }
  }
  return lines;
}

export function makePartnerSourceReadHandler(deps: PartnerSourceReadDeps): ToolHandler {
  return async (
    input: Record<string, unknown>,
    toolContext?: SdkToolExecutionContextLike,
  ): Promise<string> => {
    const ctx = resolveSessionRunContext(toolContext);
    if (!ctx) {
      return 'Error: partner_source_read was called outside an active session run.';
    }
    if (ctx.surface !== 'partner') {
      return 'Error: partner_source_read is only available in Partner sessions.';
    }

    const sourceId = typeof input.sourceId === 'string' ? input.sourceId.trim() : '';
    if (!sourceId) return 'Error: sourceId is required.';

    const source = await deps.store.get(ctx.sessionId, sourceId);
    if (!source) return `Error: source not found for this Partner session: ${sourceId}`;

    if (
      canonProjectRoot(source.projectRoot, process.platform === 'win32') !==
      canonProjectRoot(ctx.projectRoot, process.platform === 'win32')
    ) {
      return 'Error: source belongs to a different project root than the current session.';
    }

    const assertAllowedProjectRoot =
      deps.assertAllowedProjectRoot ?? ((projectRoot: string) => projectStore.assertAllowed(projectRoot));
    const allowedRoot = await assertAllowedProjectRoot(source.projectRoot);
    const absPath = await resolveInsideProject(allowedRoot, source.path);

    if (source.targetKind === 'dir') {
      const counter = { count: 0 };
      const tree = await walkTree(allowedRoot, absPath, 2, counter);
      const body = renderTree(tree).join('\n') || '(empty directory)';
      return capToolResult(
        [
          `Source: ${source.id}`,
          `Path: ${source.path}`,
          'Kind: directory',
          `Truncated: ${counter.count >= 5000 ? 'yes' : 'no'}`,
          '',
          body,
        ].join('\n'),
      );
    }

    const read = await readFileWithGuards(absPath);
    if (read.truncated) {
      return `Source: ${source.id}\nPath: ${source.path}\nKind: file\nSize: ${read.size}\n\n[File is too large to read inline.]`;
    }
    if (read.isBinary) {
      return `Source: ${source.id}\nPath: ${source.path}\nKind: file\nSize: ${read.size}\n\n[Binary file; text content unavailable.]`;
    }
    return capToolResult(
      [
        `Source: ${source.id}`,
        `Path: ${source.path}`,
        'Kind: file',
        `Size: ${read.size}`,
        '',
        read.content,
      ].join('\n'),
    );
  };
}

let registered = false;

export function _resetPartnerSourceToolRegistrationForTesting(): void {
  registered = false;
}

export function ensurePartnerSourceToolRegistered(sdk: unknown): void {
  if (registered) return;
  const reg = (sdk as { registerTool?: (def: unknown) => () => void }).registerTool;
  if (typeof reg !== 'function') {
    console.warn('[partner-source] sdk.registerTool unavailable; partner_source_read not registered');
    return;
  }
  reg({
    ...PARTNER_SOURCE_READ_TOOL,
    handler: makePartnerSourceReadHandler({ store: partnerSourceStore }),
  });
  registerPartnerSpaceToolPolicy({
    name: PARTNER_SOURCE_READ_TOOL.name,
    scope: 'source',
    sideEffect: PARTNER_SOURCE_READ_TOOL.sideEffect,
    description: 'Reads user-selected Partner sources for evidence gathering.',
  });
  registered = true;
}
