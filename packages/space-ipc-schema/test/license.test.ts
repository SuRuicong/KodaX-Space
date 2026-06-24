import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INVOKE_CHANNEL_NAMES,
  invokeChannels,
  licenseEntitlementEnvelopeSchema,
  licenseExportRequestChannel,
  licenseGetStatusChannel,
  licenseHasFeatureChannel,
  licenseImportEntitlementChannel,
  licenseRequireEntitlementChannel,
} from '../src/index.js';

test('license channels are registered', () => {
  for (const name of [
    'license.getStatus',
    'license.importEntitlement',
    'license.exportRequest',
    'license.requireEntitlement',
    'license.hasFeature',
  ]) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be registered`);
    assert.ok(INVOKE_CHANNEL_NAMES.has(name), `${name} should be in preload allowlist`);
  }
});

test('license status output accepts community and licensed states', () => {
  const community = {
    status: 'community',
    edition: 'community',
    licenseKind: null,
    managedRequired: false,
    enforcementSource: 'none',
    licenseId: null,
    customer: null,
    expiresAt: null,
    features: [],
    reason: null,
    lastCheckedAt: '2026-06-24T00:00:00.000Z',
    degraded: false,
  };
  assert.equal(licenseGetStatusChannel.output.safeParse(community).success, true);

  const licensed = {
    ...community,
    status: 'licensed',
    edition: 'enterprise',
    licenseKind: 'evaluation',
    licenseId: 'lic_example',
    customer: 'Example Corp',
    expiresAt: '2026-07-24T00:00:00.000Z',
    features: ['enterprise-evaluation', 'offline'],
  };
  assert.equal(licenseGetStatusChannel.output.safeParse(licensed).success, true);
});

test('license entitlement envelope separates edition from licenseKind', () => {
  const result = licenseEntitlementEnvelopeSchema.safeParse({
    schema: 'kodax-license/v1',
    kid: 'kid_test',
    alg: 'Ed25519',
    payload: {
      product: 'kodax-space',
      licenseFamily: 'KodaX-AI Fair Core License',
      licenseId: 'lic_example',
      customer: 'Example Corp',
      edition: 'enterprise',
      licenseKind: 'evaluation',
      issuedAt: '2026-06-24T00:00:00.000Z',
      expiresAt: '2026-07-24T00:00:00.000Z',
      features: ['enterprise-evaluation', 'offline'],
      binding: {
        mode: 'site',
        siteId: 'example-intranet',
      },
    },
    signature: 'base64url-signature-placeholder',
  });
  assert.equal(result.success, true);
});

test('license entitlement rejects trial as an edition', () => {
  const result = licenseEntitlementEnvelopeSchema.safeParse({
    schema: 'kodax-license/v1',
    kid: 'kid_test',
    alg: 'Ed25519',
    payload: {
      product: 'kodax-space',
      licenseFamily: 'KodaX-AI Fair Core License',
      licenseId: 'lic_example',
      customer: 'Example Corp',
      edition: 'trial',
      licenseKind: 'evaluation',
      issuedAt: '2026-06-24T00:00:00.000Z',
      expiresAt: '2026-07-24T00:00:00.000Z',
      features: [],
    },
    signature: 'base64url-signature-placeholder',
  });
  assert.equal(result.success, false);
});

test('license invoke input schemas cover MVP operations', () => {
  assert.equal(
    licenseImportEntitlementChannel.input.safeParse({ filePath: 'C:/x.kodax-license' }).success,
    true,
  );
  assert.equal(
    licenseExportRequestChannel.input.safeParse({ requestedEdition: 'enterprise' }).success,
    true,
  );
  assert.equal(
    licenseRequireEntitlementChannel.input.safeParse({ featureId: 'enterprise-evaluation' })
      .success,
    true,
  );
  assert.equal(licenseHasFeatureChannel.input.safeParse({ featureId: 'offline' }).success, true);

  assert.equal(licenseHasFeatureChannel.input.safeParse({ featureId: '../bad' }).success, false);
});
