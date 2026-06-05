// Unit tests for renderer fuzzy matcher (F026 — pure JS lib, runs in node-test).
//
// Lib lives under renderer/src but has zero DOM/React deps, so we import it
// directly. The relative path crosses the renderer/electron boundary on purpose;
// keeping the lib in renderer matches its primary consumer (CommandPalette).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatcher, scoreCandidate } from '../../renderer/src/lib/fuzzy.js';

test('scoreCandidate: consecutive substring beats scattered chars at same boundary count', () => {
  // 'src' all consecutive in 'parser-src.ts', vs scattered 's', 'r', 'c' in 'serializer-cache.ts'
  const consecutive = scoreCandidate('parser-src.ts', 'src');
  const scattered = scoreCandidate('serializer-cache.ts', 'src');
  // 假设两者都匹配 — 若 scattered = -Inf 则比较退化为 trivial 通过，没意义
  assert.ok(scattered > -Infinity, 'scattered candidate should still be a valid match');
  assert.ok(consecutive > scattered, `consecutive ${consecutive} should beat scattered ${scattered}`);
});

test('scoreCandidate: basename match beats dirname-only match', () => {
  // 'parser.ts' has 'parser' as the entire basename (highest signal)
  // 'parser/lib/helper.ts' has 'parser' only in dirname
  const basename = scoreCandidate('parser.ts', 'parser');
  const dirname = scoreCandidate('parser/lib/helper.ts', 'parser');
  assert.ok(basename > 0);
  assert.ok(dirname > 0);
  assert.ok(basename > dirname, `basename ${basename} should beat dirname ${dirname}`);
});

test('scoreCandidate: returns -Infinity when query chars not all present', () => {
  assert.equal(scoreCandidate('foo.ts', 'bar'), -Infinity);
  assert.equal(scoreCandidate('foo.ts', 'foox'), -Infinity);
});

test('scoreCandidate: empty query returns 0 (no signal)', () => {
  assert.equal(scoreCandidate('whatever.ts', ''), 0);
});

test('scoreCandidate: case insensitive', () => {
  const lower = scoreCandidate('readme.md', 'readme');
  const upper = scoreCandidate('README.md', 'readme');
  assert.ok(lower > 0);
  assert.ok(upper > 0);
});

test('scoreCandidate: shorter candidate edges out longer at same match quality', () => {
  const short = scoreCandidate('foo.ts', 'foo');
  const longer = scoreCandidate('foobar.ts', 'foo');
  assert.ok(short > longer, `short ${short} should beat longer ${longer}`);
});

test('scoreCandidate: consecutive match bonus', () => {
  // 'src/auth.ts' has consecutive 'a-u-t-h' in basename
  // 'a_u_t_h.ts' has same chars but separated
  const consecutive = scoreCandidate('src/auth.ts', 'auth');
  const broken = scoreCandidate('a_u_t_h.ts', 'auth');
  assert.ok(consecutive > broken, `consecutive ${consecutive} should beat broken ${broken}`);
});

test('createMatcher: filters out non-matches, sorts by score desc', () => {
  const matcher = createMatcher();
  matcher.setCandidates([
    'src/foo.ts',
    'docs/bar.md',
    'src/foo/baz.ts',
    'user-foo-record.ts',
  ]);
  const out = matcher.search('foo');
  assert.equal(out.length, 3, 'bar.md should be filtered');
  // src/foo.ts (basename + boundary) should outrank user-foo-record
  const items = out.map((m) => m.item);
  assert.ok(items.indexOf('src/foo.ts') < items.indexOf('user-foo-record.ts'));
});

test('createMatcher: empty query returns first N in input order (preserves caller ranking)', () => {
  const matcher = createMatcher();
  matcher.setCandidates(['a', 'b', 'c', 'd', 'e']);
  const out = matcher.search('', 3);
  assert.deepEqual(
    out.map((m) => m.item),
    ['a', 'b', 'c']
  );
});

test('createMatcher: limit param caps result count', () => {
  const matcher = createMatcher();
  matcher.setCandidates(['foo1', 'foo2', 'foo3', 'foo4', 'foo5']);
  const out = matcher.search('foo', 2);
  assert.equal(out.length, 2);
});

test('createMatcher: stable sort — equal scores keep input order', () => {
  const matcher = createMatcher();
  // 同 basename 同形态 → 应该平分
  matcher.setCandidates(['a/foo.ts', 'b/foo.ts', 'c/foo.ts']);
  const out = matcher.search('foo.ts');
  assert.deepEqual(
    out.map((m) => m.item),
    ['a/foo.ts', 'b/foo.ts', 'c/foo.ts'],
    'equal scores should preserve input order (stable)'
  );
});

test('createMatcher: handles 5k candidates under reasonable time', () => {
  const matcher = createMatcher();
  const items: string[] = [];
  for (let i = 0; i < 5000; i++) {
    items.push(`src/module${i}/component${i}.tsx`);
  }
  matcher.setCandidates(items);
  const start = process.hrtime.bigint();
  const out = matcher.search('mod42', 30);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  assert.ok(out.length > 0, 'should find module42-related matches');
  // Generous bound for CI; aim for sub-50ms locally
  assert.ok(elapsedMs < 200, `5k fuzzy search took ${elapsedMs.toFixed(2)}ms`);
});
