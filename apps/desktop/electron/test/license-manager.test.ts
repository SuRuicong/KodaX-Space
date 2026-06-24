import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign } from 'node:crypto';
import { LicenseManager, type ManagedPolicy } from '../license/manager.js';
import {
  licenseSignatureMessage,
  verifyLicenseEnvelope,
  type VerificationKey,
} from '../license/entitlement.js';
import { EMBEDDED_LICENSE_KEYS } from '../license/keys.js';
import { parseManagedPolicy } from '../license/policy.js';
import type { LicenseEntitlementPayloadT } from '@kodax-space/space-ipc-schema';

let tmpDir = '';
let licenseDir = '';
let entitlementFile = '';
let stateFile = '';
const testDir = path.dirname(fileURLToPath(import.meta.url));
const licenseFixtureDir = path.join(testDir, 'fixtures/license');

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-license-'));
  licenseDir = path.join(tmpDir, 'license');
  entitlementFile = path.join(licenseDir, 'entitlement.kodax-license');
  stateFile = path.join(licenseDir, 'state.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test('clean install resolves to community status', async () => {
  const manager = createManager({ keys: [] });

  const status = await manager.getStatus();

  assert.equal(status.status, 'community');
  assert.equal(status.edition, 'community');
  assert.equal(status.managedRequired, false);
});

test('imports a valid enterprise evaluation entitlement', async () => {
  const fixture = createSignedLicense({ expiresAt: '2026-07-24T00:00:00.000Z' });
  const filePath = path.join(tmpDir, 'valid.kodax-license');
  await fs.writeFile(filePath, fixture.raw, 'utf-8');
  const manager = createManager({ keys: [fixture.key], now: new Date('2026-06-24T00:00:00.000Z') });

  const imported = await manager.importEntitlement(filePath);
  const status = await manager.getStatus();

  assert.equal(imported.imported, true);
  assert.equal(status.status, 'licensed');
  assert.equal(status.edition, 'enterprise');
  assert.equal(status.licenseKind, 'evaluation');
  assert.equal(status.customer, 'Example Corp');
  assert.deepEqual(status.features, ['enterprise-evaluation', 'offline']);
});

test('expired entitlement is rejected and does not replace community status', async () => {
  const fixture = createSignedLicense({ expiresAt: '2026-06-01T00:00:00.000Z' });
  const filePath = path.join(tmpDir, 'expired.kodax-license');
  await fs.writeFile(filePath, fixture.raw, 'utf-8');
  const manager = createManager({ keys: [fixture.key], now: new Date('2026-06-24T00:00:00.000Z') });

  const imported = await manager.importEntitlement(filePath);
  const status = await manager.getStatus();

  assert.equal(imported.imported, false);
  assert.equal(imported.status.status, 'expired');
  assert.equal(status.status, 'community');
});

test('production mode rejects development signing keys', async () => {
  const fixture = createSignedLicense({
    expiresAt: '2026-07-24T00:00:00.000Z',
    keyProduction: false,
  });
  const filePath = path.join(tmpDir, 'dev-key.kodax-license');
  await fs.writeFile(filePath, fixture.raw, 'utf-8');
  const manager = createManager({ keys: [fixture.key], now: new Date('2026-06-24T00:00:00.000Z') });

  const imported = await manager.importEntitlement(filePath);

  assert.equal(imported.imported, false);
  assert.equal(imported.status.status, 'invalid');
  assert.match(imported.message, /development\/test signing key/i);
});

test('clock rollback degrades an otherwise valid entitlement', async () => {
  const fixture = createSignedLicense({ expiresAt: '2026-07-24T00:00:00.000Z' });
  const filePath = path.join(tmpDir, 'valid.kodax-license');
  await fs.writeFile(filePath, fixture.raw, 'utf-8');
  const manager = createManager({ keys: [fixture.key], now: new Date('2026-06-24T00:00:00.000Z') });
  await manager.importEntitlement(filePath);

  const rollbackManager = createManager({
    keys: [fixture.key],
    now: new Date('2026-06-23T23:00:00.000Z'),
  });
  const status = await rollbackManager.getStatus();

  assert.equal(status.status, 'degraded');
  assert.equal(status.degraded, true);
});

test('clock rolled back before issuance degrades even without a state baseline', async () => {
  // Threat: a local user deletes state.json (user-writable) to wipe the rollback
  // baseline, then rolls the system clock back to extend an expiring license. The
  // signed issuedAt is a stateless floor that survives state.json deletion.
  const fixture = createSignedLicense({ expiresAt: '2026-07-24T00:00:00.000Z' });
  const filePath = path.join(tmpDir, 'valid.kodax-license');
  await fs.writeFile(filePath, fixture.raw, 'utf-8');
  const manager = createManager({ keys: [fixture.key], now: new Date('2026-06-24T00:00:00.000Z') });
  await manager.importEntitlement(filePath);

  // Wipe the persisted rollback baseline, then observe at a clock well before issuedAt.
  await fs.rm(stateFile, { force: true });
  const rolledBack = createManager({
    keys: [fixture.key],
    now: new Date('2026-06-20T00:00:00.000Z'),
  });
  const status = await rolledBack.getStatus();

  assert.equal(status.status, 'degraded');
  assert.equal(status.degraded, true);
});

test('exportRequest writes an offline request file', async () => {
  const manager = createManager({ keys: [], now: new Date('2026-06-24T00:00:00.000Z') });

  const exported = await manager.exportRequest({ requestedEdition: 'enterprise' });

  assert.equal(exported.request.schema, 'kodax-license-request/v1');
  assert.equal(exported.request.product, 'kodax-space');
  assert.equal(exported.request.requestedEdition, 'enterprise');
  assert.equal(
    await fs.readFile(exported.filePath, 'utf-8'),
    JSON.stringify(exported.request, null, 2),
  );
});

test('exportRequest uses managed package site id when present', async () => {
  const manager = createManager({
    keys: [],
    now: new Date('2026-06-24T00:00:00.000Z'),
    managedPolicy: {
      required: true,
      source: 'build-metadata',
      siteId: 'customer-site-001',
    },
  });

  const exported = await manager.exportRequest({ requestedEdition: 'enterprise' });

  assert.equal(exported.request.siteId, 'customer-site-001');
});

test('site binding mismatch rejects import', async () => {
  const fixture = createSignedLicense({
    expiresAt: '2026-07-24T00:00:00.000Z',
    bindingSiteId: 'site-a',
  });
  const filePath = path.join(tmpDir, 'site-a.kodax-license');
  await fs.writeFile(filePath, fixture.raw, 'utf-8');
  const manager = createManager({
    keys: [fixture.key],
    now: new Date('2026-06-24T00:00:00.000Z'),
    managedPolicy: {
      required: true,
      source: 'build-metadata',
      siteId: 'site-b',
    },
  });

  const imported = await manager.importEntitlement(filePath);

  assert.equal(imported.imported, false);
  assert.equal(imported.status.status, 'invalid');
  assert.match(imported.message, /binding/i);
});

test('managed policy metadata can require a package license', () => {
  const policy = parseManagedPolicy(
    {
      schema: 'kodax-license-policy/v1',
      license: {
        required: true,
        siteId: 'synthetic-customer-site',
        reason: 'Customer package requires a license.',
      },
    },
    'build-metadata',
  );

  assert.deepEqual(policy, {
    required: true,
    source: 'build-metadata',
    siteId: 'synthetic-customer-site',
    reason: 'Customer package requires a license.',
  });
});

test('embedded production keys include the real issuer key only', () => {
  assert.equal(
    EMBEDDED_LICENSE_KEYS.some((key) => key.kid === 'kai-prod-2026-q3'),
    true,
  );
  assert.equal(
    EMBEDDED_LICENSE_KEYS.some((key) => key.kid.includes('synthetic')),
    false,
  );
});

test('issuer synthetic production fixture verifies only with the synthetic test key', async () => {
  const raw = await fs.readFile(
    path.join(licenseFixtureDir, 'synthetic-production-evaluation.kodax-license'),
    'utf-8',
  );
  const syntheticKey = JSON.parse(
    await fs.readFile(
      path.join(licenseFixtureDir, 'synthetic-production-public-key.json'),
      'utf-8',
    ),
  ) as VerificationKey;

  const verified = verifyLicenseEnvelope(raw, { keys: [syntheticKey] });
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.payload.customer, 'Synthetic Customer');
    assert.equal(verified.payload.binding?.siteId, 'synthetic-customer-site');
  }

  const productionEmbeddedResult = verifyLicenseEnvelope(raw, { keys: EMBEDDED_LICENSE_KEYS });
  assert.equal(productionEmbeddedResult.ok, false);
  if (!productionEmbeddedResult.ok) {
    assert.equal(productionEmbeddedResult.code, 'UNKNOWN_KEY');
  }
});

test('issuer synthetic fixture imports when the package site matches', async () => {
  const raw = await fs.readFile(
    path.join(licenseFixtureDir, 'synthetic-production-evaluation.kodax-license'),
    'utf-8',
  );
  const syntheticKey = JSON.parse(
    await fs.readFile(
      path.join(licenseFixtureDir, 'synthetic-production-public-key.json'),
      'utf-8',
    ),
  ) as VerificationKey;
  const filePath = path.join(tmpDir, 'synthetic.kodax-license');
  await fs.writeFile(filePath, raw, 'utf-8');
  const manager = createManager({
    keys: [syntheticKey],
    now: new Date('2026-06-24T00:00:00.000Z'),
    managedPolicy: {
      required: true,
      source: 'build-metadata',
      siteId: 'synthetic-customer-site',
    },
  });

  const imported = await manager.importEntitlement(filePath);
  const status = await manager.getStatus();

  assert.equal(imported.imported, true);
  assert.equal(status.status, 'licensed');
  assert.equal(status.managedRequired, true);
  assert.equal(status.enforcementSource, 'build-metadata');
  assert.equal(status.customer, 'Synthetic Customer');
});

function createManager(options: {
  readonly keys: readonly VerificationKey[];
  readonly now?: Date;
  readonly allowNonProductionKeys?: boolean;
  readonly managedPolicy?: ManagedPolicy;
}): LicenseManager {
  return new LicenseManager({
    dir: licenseDir,
    entitlementFile,
    stateFile,
    keys: options.keys,
    allowNonProductionKeys: options.allowNonProductionKeys,
    managedPolicy: options.managedPolicy,
    now: () => options.now ?? new Date('2026-06-24T00:00:00.000Z'),
  });
}

function createSignedLicense(options: {
  readonly expiresAt: string;
  readonly keyProduction?: boolean;
  readonly bindingSiteId?: string;
}): { readonly raw: string; readonly key: VerificationKey } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const kid = options.keyProduction === false ? 'kid_dev_test' : 'kid_prod_test';
  const payload: LicenseEntitlementPayloadT = {
    product: 'kodax-space',
    licenseFamily: 'KodaX-AI Fair Core License',
    licenseId: 'lic_example',
    customer: 'Example Corp',
    edition: 'enterprise',
    licenseKind: 'evaluation',
    issuedAt: '2026-06-24T00:00:00.000Z',
    expiresAt: options.expiresAt,
    features: ['enterprise-evaluation', 'offline'],
    ...(options.bindingSiteId
      ? { binding: { mode: 'site', siteId: options.bindingSiteId } }
      : {}),
  };
  const envelopeWithoutSignature = {
    schema: 'kodax-license/v1' as const,
    kid,
    alg: 'Ed25519' as const,
    payload,
  };
  const signature = sign(
    null,
    Buffer.from(licenseSignatureMessage(envelopeWithoutSignature), 'utf-8'),
    privateKey,
  ).toString('base64url');
  const raw = JSON.stringify({ ...envelopeWithoutSignature, signature }, null, 2);
  const key: VerificationKey = {
    kid,
    alg: 'Ed25519',
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    production: options.keyProduction !== false,
  };
  return { raw, key };
}
