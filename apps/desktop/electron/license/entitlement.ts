import { verify as verifyOneShot } from 'node:crypto';
import {
  licenseEntitlementEnvelopeSchema,
  type LicenseEntitlementEnvelopeT,
  type LicenseEntitlementPayloadT,
} from '@kodax-space/space-ipc-schema';

export interface VerificationKey {
  readonly kid: string;
  readonly alg: 'Ed25519';
  readonly publicKeyPem: string;
  readonly production: boolean;
}

export type LicenseVerificationCode =
  | 'MALFORMED'
  | 'UNKNOWN_KEY'
  | 'DEV_KEY_REJECTED'
  | 'SIGNATURE_INVALID'
  | 'DEV_KIND_REJECTED';

export type LicenseVerificationResult =
  | {
      readonly ok: true;
      readonly envelope: LicenseEntitlementEnvelopeT;
      readonly payload: LicenseEntitlementPayloadT;
    }
  | {
      readonly ok: false;
      readonly code: LicenseVerificationCode;
      readonly message: string;
    };

export interface VerifyLicenseOptions {
  readonly keys: readonly VerificationKey[];
  readonly allowNonProductionKeys?: boolean;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function licenseSignatureMessage(
  envelope: Pick<LicenseEntitlementEnvelopeT, 'kid' | 'payload'>,
): string {
  return `kodax-license/v1\n${envelope.kid}\n${canonicalJson(envelope.payload)}`;
}

export function verifyLicenseEnvelope(
  raw: string,
  options: VerifyLicenseOptions,
): LicenseVerificationResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'MALFORMED', message: 'License file is not valid JSON.' };
  }

  const parsed = licenseEntitlementEnvelopeSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'MALFORMED',
      message: 'License file does not match kodax-license/v1.',
    };
  }

  const envelope = parsed.data;
  const key = options.keys.find((candidate) => candidate.kid === envelope.kid);
  if (!key) {
    return {
      ok: false,
      code: 'UNKNOWN_KEY',
      message: `Unknown license signing key: ${envelope.kid}`,
    };
  }

  const allowNonProductionKeys = options.allowNonProductionKeys === true;
  if (!key.production && !allowNonProductionKeys) {
    return {
      ok: false,
      code: 'DEV_KEY_REJECTED',
      message:
        'This license uses a development/test signing key and cannot be used in production builds.',
    };
  }

  if (
    !allowNonProductionKeys &&
    (envelope.payload.licenseKind === 'dev' || envelope.payload.licenseKind === 'test')
  ) {
    return {
      ok: false,
      code: 'DEV_KIND_REJECTED',
      message: 'Development/test license kinds are rejected by production builds.',
    };
  }

  const signature = decodeBase64Url(envelope.signature);
  const message = Buffer.from(licenseSignatureMessage(envelope), 'utf-8');

  // Ed25519 verification only. `verify(null, ...)` derives the algorithm from the
  // pinned public key, never from the (attacker-controlled) envelope `alg` field —
  // so there is no algorithm-confusion surface. Any failure (bad signature,
  // malformed key PEM, crypto error) is fail-closed: signatureOk stays false.
  // NB: do NOT add a SHA-256 / createVerify fallback here — a SHA-256 signature is
  // not a valid format for an Ed25519 key, and retrying with a different algorithm
  // would reopen an algorithm-confusion bypass.
  let signatureOk = false;
  try {
    signatureOk = verifyOneShot(null, message, key.publicKeyPem, signature);
  } catch {
    signatureOk = false;
  }

  if (!signatureOk) {
    return { ok: false, code: 'SIGNATURE_INVALID', message: 'License signature is invalid.' };
  }

  return { ok: true, envelope, payload: envelope.payload };
}

function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    output[key] = sortJson(input[key]);
  }
  return output;
}
