import type { VerificationKey } from './entitlement.js';

// Production verification keys are exported from the private issuer project.
// Keep this list public-key only; no private signing key may ever be packaged.
export const EMBEDDED_LICENSE_KEYS = [
  {
    kid: 'kai-prod-2026-q3',
    alg: 'Ed25519',
    publicKeyPem:
      '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEApS5/PyjyopCM+aXbAZUZI/MHtIWbR9ppPznb7OhYxjM=\n-----END PUBLIC KEY-----\n',
    production: true,
  }
] as const satisfies readonly VerificationKey[];
