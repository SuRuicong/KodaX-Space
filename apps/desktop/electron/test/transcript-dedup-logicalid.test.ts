import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeTranscriptEntries } from '../ipc/transcript-dedup.js';

test('repeated logicalId folds inactive clones before content-hash fallback', () => {
  const entries = [
    {
      logicalId: 'm1',
      type: 'message',
      active: false,
      message: { role: 'assistant', content: 'old island copy' },
    },
    {
      logicalId: 'm1',
      type: 'message',
      active: true,
      message: { role: 'assistant', content: 'active copy with normalized content' },
    },
    {
      logicalId: 'm2',
      type: 'message',
      active: false,
      message: { role: 'user', content: 'unique inactive history' },
    },
  ];

  const out = dedupeTranscriptEntries(entries);

  assert.equal(out.length, 2);
  assert.equal(
    out.some((entry) => entry.message.content === 'active copy with normalized content'),
    true,
  );
  assert.equal(
    out.some((entry) => entry.message.content === 'unique inactive history'),
    true,
  );
});

test('unique fallback logicalIds keep legacy content-hash dedupe active', () => {
  const entries = [
    {
      logicalId: 'entry-1',
      type: 'message',
      active: false,
      message: { role: 'user', content: 'same legacy clone' },
    },
    {
      logicalId: 'entry-2',
      type: 'message',
      active: false,
      message: { role: 'user', content: 'same legacy clone' },
    },
  ];

  assert.equal(dedupeTranscriptEntries(entries).length, 1);
});
