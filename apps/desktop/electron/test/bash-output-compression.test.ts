import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBashOutputCompression,
  stripBashOutputRecoveryHint,
} from '../../renderer/src/features/session/messages/bashOutputCompression.js';

test('parseBashOutputCompression detects KodaX 0.7.61 recovery hint and filter marker', () => {
  const result = [
    'Command: git diff',
    'Exit: 0',
    '[git diff summarized: 120 files, +120 -120]',
    '[Bash output compressed by git-diff.]',
    '[Bash output compressed; full raw output saved to: C:\\tmp\\git-diff-raw.txt. Use read on that path if details are needed.]',
  ].join('\n');

  assert.deepEqual(parseBashOutputCompression(result), {
    filters: ['git-diff'],
    rawOutputPath: 'C:\\tmp\\git-diff-raw.txt',
  });
});

test('parseBashOutputCompression returns null for ordinary bash output', () => {
  assert.equal(parseBashOutputCompression('Command: npm test\nExit: 0\nok'), null);
});

test('parseBashOutputCompression dedupes multiple filter markers', () => {
  const result = [
    '[Bash output compressed by package-manager-progress.]',
    '[Bash output compressed by package-manager-progress.]',
    '[Bash output compressed by lint.]',
  ].join('\n');

  assert.deepEqual(parseBashOutputCompression(result), {
    filters: ['package-manager-progress', 'lint'],
  });
});

test('stripBashOutputRecoveryHint removes only the raw-output hint', () => {
  const result = [
    'Command: git diff',
    'Exit: 0',
    '[Bash output compressed by git-diff.]',
    '[Bash output compressed; full raw output saved to: C:\\tmp\\raw-output.txt. Use read on that path if details are needed.]',
  ].join('\n');

  assert.equal(
    stripBashOutputRecoveryHint(result),
    ['Command: git diff', 'Exit: 0', '[Bash output compressed by git-diff.]'].join('\n'),
  );
});
