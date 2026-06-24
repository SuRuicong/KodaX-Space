import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ManagedPolicy } from './manager.js';

const POLICY_FILE_NAME = 'kodax-license-policy.json';
const POLICY_SCHEMA = 'kodax-license-policy/v1';

type PolicySource = Exclude<ManagedPolicy['source'], 'none' | 'dev-override'>;

export function loadManagedLicensePolicy(): ManagedPolicy {
  const devOverride = loadDevOverridePolicy();
  if (devOverride !== null) return devOverride;

  for (const filePath of packagedPolicyCandidatePaths()) {
    const policy = loadManagedPolicyFile(filePath, 'build-metadata');
    if (policy !== null) return policy;
  }

  return defaultPolicy();
}

export function packagedPolicyCandidatePaths(): string[] {
  const candidates: string[] = [];
  const resourcesPath = (process as typeof process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, POLICY_FILE_NAME));
  }

  candidates.push(path.join(process.cwd(), 'resources', POLICY_FILE_NAME));
  candidates.push(path.join(process.cwd(), POLICY_FILE_NAME));

  return [...new Set(candidates)];
}

export function loadManagedPolicyFile(
  filePath: string,
  source: PolicySource,
): ManagedPolicy | null {
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, 'utf-8');
    return parseManagedPolicy(JSON.parse(raw), source);
  } catch {
    return invalidPolicy(source);
  }
}

export function parseManagedPolicy(value: unknown, source: PolicySource): ManagedPolicy {
  if (!isRecord(value) || value.schema !== POLICY_SCHEMA || !isRecord(value.license)) {
    return invalidPolicy(source);
  }

  const license = value.license;
  if (typeof license.required !== 'boolean') {
    return invalidPolicy(source);
  }

  if (license.required === false) return defaultPolicy();

  const siteId = optionalBoundedString(license.siteId, 256);
  const reason = optionalBoundedString(license.reason, 512);
  if (license.siteId !== undefined && siteId === undefined) return invalidPolicy(source);
  if (license.reason !== undefined && reason === undefined) return invalidPolicy(source);

  return {
    required: true,
    source,
    ...(siteId !== undefined ? { siteId } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

function loadDevOverridePolicy(): ManagedPolicy | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (process.env.KODAX_SPACE_LICENSE_REQUIRED !== '1') return null;

  const siteId = optionalBoundedString(process.env.KODAX_SPACE_LICENSE_SITE_ID, 256);
  return {
    required: true,
    source: 'dev-override',
    ...(siteId !== undefined ? { siteId } : {}),
  };
}

function invalidPolicy(source: PolicySource): ManagedPolicy {
  return {
    required: true,
    source,
    reason: 'License policy metadata is invalid.',
  };
}

function defaultPolicy(): ManagedPolicy {
  return { required: false, source: 'none' };
}

function optionalBoundedString(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) return undefined;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
