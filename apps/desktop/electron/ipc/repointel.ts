import fs from 'node:fs';
import path from 'node:path';
import { registerChannel } from './register.js';
import type { RepointelStatusItemT, RepointelStatusOutput } from '@kodax-space/space-ipc-schema';

const WARM_UNSUPPORTED_REASON =
  'The current KodaX SDK exposes repo-intelligence through session trace events, but not a standalone warm API.';

function canReadDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function findGitRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const marker = path.join(current, '.git');
    if (fs.existsSync(marker)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function item(id: string, status: RepointelStatusItemT['status'], detail: string): RepointelStatusItemT {
  return { id, status, detail };
}

function buildStatus(projectRoot: string | undefined): RepointelStatusOutput {
  const normalizedProjectRoot = projectRoot ? path.resolve(projectRoot) : null;
  const projectExists = normalizedProjectRoot !== null && canReadDirectory(normalizedProjectRoot);
  const gitRoot = projectExists ? findGitRoot(normalizedProjectRoot) : null;

  const diagnostics: RepointelStatusItemT[] = [
    normalizedProjectRoot
      ? item(
          'project',
          projectExists ? 'ok' : 'warn',
          projectExists
            ? `Project directory is readable: ${normalizedProjectRoot}`
            : `Project directory is not readable: ${normalizedProjectRoot}`,
        )
      : item('project', 'warn', 'No projectRoot was provided by the renderer.'),
    item(
      'git',
      gitRoot ? 'ok' : 'warn',
      gitRoot
        ? `Git root detected: ${gitRoot}`
        : 'No .git marker was found from projectRoot upward.',
    ),
    item(
      'trace',
      'ok',
      'Space consumes KodaX repo-intelligence trace events from active session events.',
    ),
    item('warm', 'blocked', WARM_UNSUPPORTED_REASON),
  ];

  return {
    projectRoot: normalizedProjectRoot,
    projectExists,
    gitRoot,
    traceSource: 'session-events',
    warmSupported: false,
    warmReason: WARM_UNSUPPORTED_REASON,
    diagnostics,
  };
}

export function registerRepointelChannels(): void {
  registerChannel('repointel.status', (input): RepointelStatusOutput => buildStatus(input.projectRoot));
}
