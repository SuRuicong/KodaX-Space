import { z } from 'zod';

export const licenseEditionSchema = z.enum(['professional', 'enterprise']);
export type LicenseEditionT = z.infer<typeof licenseEditionSchema>;

export const licenseDisplayEditionSchema = z.enum(['community', 'professional', 'enterprise']);
export type LicenseDisplayEditionT = z.infer<typeof licenseDisplayEditionSchema>;

export const licenseKindSchema = z.enum(['evaluation', 'commercial', 'partner', 'dev', 'test']);
export type LicenseKindT = z.infer<typeof licenseKindSchema>;

export const licenseRuntimeStatusSchema = z.enum([
  'community',
  'licensed',
  'expired',
  'invalid',
  'required',
  'degraded',
]);
export type LicenseRuntimeStatusT = z.infer<typeof licenseRuntimeStatusSchema>;

export const licenseEnforcementSourceSchema = z.enum([
  'none',
  'build-metadata',
  'signed-policy-manifest',
  'dev-override',
]);
export type LicenseEnforcementSourceT = z.infer<typeof licenseEnforcementSourceSchema>;

export const licenseFeatureIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);

export const licenseBindingSchema = z
  .object({
    mode: z.enum(['none', 'site', 'machine', 'site-or-machine']),
    siteId: z.string().min(1).max(256).optional(),
    deviceIds: z.array(z.string().min(1).max(256)).max(64).optional(),
  })
  .strict();
export type LicenseBindingT = z.infer<typeof licenseBindingSchema>;

export const licenseEntitlementPayloadSchema = z
  .object({
    product: z.literal('kodax-space'),
    licenseFamily: z.literal('KodaX-AI Fair Core License'),
    licenseId: z.string().min(1).max(128),
    customer: z.string().min(1).max(256),
    edition: licenseEditionSchema,
    licenseKind: licenseKindSchema,
    issuedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    features: z.array(licenseFeatureIdSchema).max(128).default([]),
    binding: licenseBindingSchema.optional(),
  })
  .strict();
export type LicenseEntitlementPayloadT = z.infer<typeof licenseEntitlementPayloadSchema>;

export const licenseEntitlementEnvelopeSchema = z
  .object({
    schema: z.literal('kodax-license/v1'),
    kid: z.string().min(1).max(128),
    alg: z.literal('Ed25519'),
    payload: licenseEntitlementPayloadSchema,
    signature: z.string().min(16).max(4096),
  })
  .strict();
export type LicenseEntitlementEnvelopeT = z.infer<typeof licenseEntitlementEnvelopeSchema>;

export const licenseStatusSchema = z
  .object({
    status: licenseRuntimeStatusSchema,
    edition: licenseDisplayEditionSchema,
    licenseKind: licenseKindSchema.nullable(),
    managedRequired: z.boolean(),
    enforcementSource: licenseEnforcementSourceSchema,
    licenseId: z.string().min(1).max(128).nullable(),
    customer: z.string().min(1).max(256).nullable(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    features: z.array(licenseFeatureIdSchema),
    reason: z.string().min(1).max(512).nullable(),
    lastCheckedAt: z.string().datetime({ offset: true }),
    degraded: z.boolean(),
  })
  .strict();
export type LicenseStatusT = z.infer<typeof licenseStatusSchema>;

/**
 * Entitlement predicate shared by main (capability gate) and renderer (UI lock).
 *
 * Current policy: ANY valid, active license unlocks gated capabilities — a signed
 * entitlement that verified, has not expired, and is not clock-rollback degraded
 * (runtime status === 'licensed'). community / expired / invalid / required /
 * degraded all read as "not entitled".
 *
 * Future Pro/Enterprise tiering should add a SIBLING predicate (e.g.
 * `meetsEdition(status, 'professional')` or `status.features.includes(id)`) rather
 * than widening this one — keep "any active license" and "tier-gated" as distinct,
 * explicit checks so a per-feature tier change is a one-line swap at the call site.
 */
export function isLicenseActive(status: LicenseStatusT): boolean {
  return status.status === 'licensed';
}

export const licenseGetStatusChannel = {
  name: 'license.getStatus',
  direction: 'invoke',
  input: z.object({}).strict(),
  output: licenseStatusSchema,
} as const;

export const licenseImportEntitlementChannel = {
  name: 'license.importEntitlement',
  direction: 'invoke',
  input: z
    .object({
      filePath: z.string().min(1).max(4096),
    })
    .strict(),
  output: z
    .object({
      imported: z.boolean(),
      message: z.string().min(1).max(512),
      status: licenseStatusSchema,
    })
    .strict(),
} as const;

export const licenseExportRequestChannel = {
  name: 'license.exportRequest',
  direction: 'invoke',
  input: z
    .object({
      requestedEdition: licenseEditionSchema.default('enterprise'),
      siteId: z.string().min(1).max(256).optional(),
    })
    .strict()
    .optional(),
  output: z
    .object({
      requestId: z.string().min(1).max(128),
      filePath: z.string().min(1).max(4096),
      request: z
        .object({
          schema: z.literal('kodax-license-request/v1'),
          requestId: z.string().min(1).max(128),
          product: z.literal('kodax-space'),
          requestedEdition: licenseEditionSchema,
          createdAt: z.string().datetime({ offset: true }),
          platform: z.string().min(1).max(64),
          siteId: z.string().min(1).max(256).optional(),
        })
        .strict(),
    })
    .strict(),
} as const;

export const licenseRequireEntitlementChannel = {
  name: 'license.requireEntitlement',
  direction: 'invoke',
  input: z
    .object({
      reason: z.string().min(1).max(256).optional(),
      featureId: licenseFeatureIdSchema.optional(),
    })
    .strict()
    .optional(),
  output: z
    .object({
      allowed: z.boolean(),
      reason: z.string().min(1).max(512).nullable(),
      status: licenseStatusSchema,
    })
    .strict(),
} as const;

export const licenseHasFeatureChannel = {
  name: 'license.hasFeature',
  direction: 'invoke',
  input: z
    .object({
      featureId: licenseFeatureIdSchema,
    })
    .strict(),
  output: z
    .object({
      hasFeature: z.boolean(),
      status: licenseStatusSchema,
    })
    .strict(),
} as const;
