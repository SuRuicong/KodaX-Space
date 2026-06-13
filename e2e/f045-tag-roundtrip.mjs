// F045 real-SDK verification — does session `tag` round-trip through the REAL
// KodaX SDK persistence? (write → listSessions summary.tag → our mapper)
//
// Addresses the [[mock别给假信心]] concern: all unit tests use the mock store,
// which is more lenient than the real SDK. The genuinely-new SDK-boundary
// behavior is: tag actually persists + comes back in the listSessions summary.
//
// Runs against a TEMP sessionsDir so it never touches ~/.kodax/sessions.
// Plain node .mjs (not tsx) → avoids the cli-boxes JSON-as-JS import bug.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createSessionManager } from '@kodax-ai/kodax/session';

// Mirrors apps/desktop/electron/kodax/session-store.ts sdkTagToSurface (unit-tested separately).
const sdkTagToSurface = (tag) => (tag === 'partner' ? 'partner' : 'code');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

async function main() {
  const tmpDir = path.join(os.tmpdir(), `kodax-f045-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  console.log(`[e2e] sessionsDir override = ${tmpDir}`);

  const mgr = createSessionManager({ sessionsDir: tmpDir });
  const gitRoot = path.join(tmpDir, 'proj');

  const base = (title, tag) => ({
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ],
    title,
    gitRoot,
    scope: 'user',
    ...(tag !== undefined ? { tag } : {}),
  });

  // WRITE: one partner-tagged, one code-tagged, one legacy (no tag)
  await mgr.storage.save('s_partner', base('doc work', 'partner'));
  await mgr.storage.save('s_code', base('coding', 'code'));
  await mgr.storage.save('s_legacy', base('old session', undefined));
  console.log('[e2e] wrote 3 sessions (partner / code / legacy-no-tag)');

  // READ back via the same query shape our production listPersistedSessions uses
  // (projectRoot + scope:'user' — NOTE: tag is NOT pushed down to the SDK).
  const summaries = await mgr.listSessions({ projectRoot: gitRoot, scope: 'user', limit: 200 });
  console.log(`[e2e] listSessions returned ${summaries.length} sessions`);
  const byId = new Map(summaries.map((s) => [s.id, s]));

  ok(summaries.length === 3, 'all 3 sessions enumerated by real SDK');
  ok(byId.has('s_partner') && byId.has('s_code') && byId.has('s_legacy'), 'all 3 ids present');

  // The core claim: tag persisted + surfaced in summary
  ok(byId.get('s_partner')?.tag === 'partner', `partner session round-trips tag='partner' (got ${JSON.stringify(byId.get('s_partner')?.tag)})`);
  ok(byId.get('s_code')?.tag === 'code', `code session round-trips tag='code' (got ${JSON.stringify(byId.get('s_code')?.tag)})`);
  ok(byId.get('s_legacy')?.tag === undefined, `legacy session has no tag (got ${JSON.stringify(byId.get('s_legacy')?.tag)})`);

  // Apply the production mapper → surface
  ok(sdkTagToSurface(byId.get('s_partner')?.tag) === 'partner', 'mapper: partner → partner');
  ok(sdkTagToSurface(byId.get('s_code')?.tag) === 'code', 'mapper: code → code');
  ok(sdkTagToSurface(byId.get('s_legacy')?.tag) === 'code', 'mapper: legacy(no tag) → code (backward compat)');

  // loadSession must also carry tag (used by host.tryResume surface recovery)
  const loaded = await mgr.loadSession('s_partner');
  ok(loaded?.tag === 'partner', `loadSession('s_partner').tag === 'partner' (tryResume path) (got ${JSON.stringify(loaded?.tag)})`);

  // cleanup temp dir
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  if (failures > 0) {
    console.error(`[e2e] FAIL: ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('[e2e] PASS — tag round-trips through the real KodaX SDK');
}

main().catch((err) => {
  console.error('[e2e] ERROR:', err);
  process.exit(1);
});
