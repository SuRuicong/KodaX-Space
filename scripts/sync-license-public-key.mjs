import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outFile = path.join(root, 'apps/desktop/electron/license/keys.ts');
const inputs = process.argv.slice(2);

if (inputs.length === 0) {
  fail('Usage: node scripts/sync-license-public-key.mjs <production-public-key.json> [...]');
}

const keys = inputs.map((input) => {
  const filePath = path.resolve(input);
  const metadata = JSON.parse(readFileSync(filePath, 'utf-8'));
  validateMetadata(metadata, filePath);
  return metadata;
});

const body = `import type { VerificationKey } from './entitlement.js';

// Production verification keys are exported from the private issuer project.
// Keep this list public-key only; no private signing key may ever be packaged.
export const EMBEDDED_LICENSE_KEYS = [
${keys.map(renderKey).join(',\n')}
] as const satisfies readonly VerificationKey[];
`;

writeFileSync(outFile, body, 'utf-8');
console.log(`[license] synced ${keys.length} production public key(s) to ${path.relative(root, outFile)}`);

function validateMetadata(metadata, filePath) {
  if (!isRecord(metadata)) fail(`${filePath}: metadata must be an object`);
  if (metadata.alg !== 'Ed25519') fail(`${filePath}: alg must be Ed25519`);
  if (metadata.production !== true) fail(`${filePath}: production must be true`);
  if (typeof metadata.kid !== 'string' || !/^kai-prod-[a-z0-9][a-z0-9._-]{0,120}$/.test(metadata.kid)) {
    fail(`${filePath}: kid must match kai-prod-*`);
  }
  if (metadata.kid.includes('synthetic')) fail(`${filePath}: synthetic key ids are test-only`);
  if (typeof metadata.publicKeyPem !== 'string' || !metadata.publicKeyPem.includes('BEGIN PUBLIC KEY')) {
    fail(`${filePath}: publicKeyPem must be a PEM public key`);
  }
}

function renderKey(key) {
  return `  {
    kid: ${quoteTsString(key.kid)},
    alg: 'Ed25519',
    publicKeyPem:
      ${quoteTsString(key.publicKeyPem)},
    production: true,
  }`;
}

function quoteTsString(value) {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}'`;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message) {
  console.error(`[license] ${message}`);
  process.exit(1);
}
