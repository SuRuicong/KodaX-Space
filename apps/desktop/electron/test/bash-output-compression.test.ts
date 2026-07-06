import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
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

test('parse/strip stay near-linear on adversarial large input (ReDoS guard)', () => {
  // Repeated opening literals that never close would backtrack O(n^2) with an
  // unbounded lazy quantifier before the long fixed suffix; the bounded, newline-
  // excluded capture groups keep it near-linear. ~1 MB (above the 512 KiB
  // tool_result ceiling) so a regression would freeze the renderer for seconds.
  const rawHintAttack = '[Bash output compressed; full raw output saved to: '.repeat(20_000);
  const filterAttack = '[Bash output compressed by '.repeat(40_000);
  const start = performance.now();
  assert.equal(parseBashOutputCompression(rawHintAttack), null); // never closes → no match
  assert.equal(parseBashOutputCompression(filterAttack), null);
  assert.ok(stripBashOutputRecoveryHint(rawHintAttack).length > 0);
  const elapsedMs = performance.now() - start;
  // Bounded form is ~tens of ms even at MBs; the unbounded regression was multiple
  // seconds at this size. Generous threshold to stay non-flaky on loaded CI.
  assert.ok(elapsedMs < 2_000, `bash-output-compression parse too slow (${elapsedMs.toFixed(0)}ms) — ReDoS?`);
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
