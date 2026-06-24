import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  type LicenseEditionT,
  type LicenseEntitlementPayloadT,
  type LicenseStatusT,
} from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from '../kodax/data-paths.js';
import {
  verifyLicenseEnvelope,
  type LicenseVerificationResult,
  type VerificationKey,
} from './entitlement.js';
import { EMBEDDED_LICENSE_KEYS } from './keys.js';
import { loadManagedLicensePolicy } from './policy.js';

const LICENSE_DIR = path.join(getSpaceDataDir(), 'license');
const ENTITLEMENT_FILE = path.join(LICENSE_DIR, 'entitlement.kodax-license');
const STATE_FILE = path.join(LICENSE_DIR, 'state.json');
const MAX_LICENSE_BYTES = 256 * 1024;
const CLOCK_ROLLBACK_TOLERANCE_MS = 10 * 60 * 1000;

interface LicenseStateFile {
  readonly version: 1;
  readonly lastSeenAt?: string;
}

export interface ManagedPolicy {
  readonly required: boolean;
  readonly source: LicenseStatusT['enforcementSource'];
  readonly siteId?: string;
  readonly reason?: string;
}

interface LicenseManagerOptions {
  readonly dir?: string;
  readonly entitlementFile?: string;
  readonly stateFile?: string;
  readonly keys?: readonly VerificationKey[];
  readonly allowNonProductionKeys?: boolean;
  readonly managedPolicy?: ManagedPolicy;
  readonly now?: () => Date;
}

interface ClockObservation {
  readonly now: Date;
  readonly rollback: boolean;
}

export class LicenseManager {
  private readonly dir: string;
  private readonly entitlementFile: string;
  private readonly stateFile: string;
  private readonly keys: readonly VerificationKey[];
  private readonly allowNonProductionKeys: boolean;
  private readonly managedPolicy: ManagedPolicy;
  private readonly nowFn: () => Date;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(options: LicenseManagerOptions = {}) {
    this.dir = options.dir ?? LICENSE_DIR;
    this.entitlementFile = options.entitlementFile ?? ENTITLEMENT_FILE;
    this.stateFile = options.stateFile ?? STATE_FILE;
    this.keys = options.keys ?? EMBEDDED_LICENSE_KEYS;
    this.allowNonProductionKeys = options.allowNonProductionKeys === true;
    this.managedPolicy = options.managedPolicy ?? { required: false, source: 'none' };
    this.nowFn = options.now ?? (() => new Date());
  }

  async getStatus(): Promise<LicenseStatusT> {
    return this.resolveStatus();
  }

  async importEntitlement(filePath: string): Promise<{
    readonly imported: boolean;
    readonly message: string;
    readonly status: LicenseStatusT;
  }> {
    const now = this.nowFn();
    const raw = await this.readCandidateFile(filePath);
    const verified = verifyLicenseEnvelope(raw, {
      keys: this.keys,
      allowNonProductionKeys: this.allowNonProductionKeys,
    });

    if (!verified.ok) {
      return {
        imported: false,
        message: verified.message,
        status: this.invalidStatus(verified.message, now),
      };
    }

    const bindingMismatch = this.bindingMismatchReason(verified.payload);
    if (bindingMismatch !== null) {
      return {
        imported: false,
        message: bindingMismatch,
        status: this.invalidStatus(bindingMismatch, now),
      };
    }

    if (Date.parse(verified.payload.expiresAt) <= now.getTime()) {
      return {
        imported: false,
        message: 'License is expired.',
        status: this.payloadStatus('expired', verified.payload, 'License is expired.', now, false),
      };
    }

    await this.serializedWrite(async () => {
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const tmp = `${this.entitlementFile}.tmp`;
      await fs.writeFile(tmp, raw, { encoding: 'utf-8', mode: 0o600 });
      await fs.rename(tmp, this.entitlementFile);
    });

    const status = await this.resolveStatus();
    return { imported: true, message: 'License imported.', status };
  }

  async exportRequest(input?: {
    readonly requestedEdition?: LicenseEditionT;
    readonly siteId?: string;
  }): Promise<{
    readonly requestId: string;
    readonly filePath: string;
    readonly request: {
      readonly schema: 'kodax-license-request/v1';
      readonly requestId: string;
      readonly product: 'kodax-space';
      readonly requestedEdition: LicenseEditionT;
      readonly createdAt: string;
      readonly platform: string;
      readonly siteId?: string;
    };
  }> {
    const requestId = `req_${randomUUID()}`;
    const siteId = input?.siteId ?? this.managedPolicy.siteId;
    const request = {
      schema: 'kodax-license-request/v1' as const,
      requestId,
      product: 'kodax-space' as const,
      requestedEdition: input?.requestedEdition ?? 'enterprise',
      createdAt: this.nowFn().toISOString(),
      platform: process.platform,
      ...(siteId ? { siteId } : {}),
    };
    const filePath = path.join(this.dir, `${requestId}.license-request.json`);

    await this.serializedWrite(async () => {
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const tmp = `${filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(request, null, 2), { encoding: 'utf-8', mode: 0o600 });
      await fs.rename(tmp, filePath);
    });

    return { requestId, filePath, request };
  }

  async requireEntitlement(input?: {
    readonly reason?: string;
    readonly featureId?: string;
  }): Promise<{
    readonly allowed: boolean;
    readonly reason: string | null;
    readonly status: LicenseStatusT;
  }> {
    const status = await this.resolveStatus();
    const featureAllowed =
      input?.featureId === undefined || status.features.includes(input.featureId);
    const allowed = status.status === 'licensed' && featureAllowed;
    return {
      allowed,
      reason: allowed
        ? null
        : (input?.reason ?? status.reason ?? 'A valid KodaX-AI license is required.'),
      status,
    };
  }

  async hasFeature(featureId: string): Promise<{
    readonly hasFeature: boolean;
    readonly status: LicenseStatusT;
  }> {
    const status = await this.resolveStatus();
    return {
      hasFeature: status.status === 'licensed' && status.features.includes(featureId),
      status,
    };
  }

  private async resolveStatus(): Promise<LicenseStatusT> {
    const clock = await this.observeClock();
    const now = clock.now;
    const raw = await this.readStoredEntitlement();
    if (raw === null) {
      return this.emptyStatus(
        this.managedPolicy.required ? 'required' : 'community',
        this.managedPolicy.required
          ? (this.managedPolicy.reason ?? 'A license is required for this package.')
          : null,
        now,
        false,
      );
    }

    const verified = verifyLicenseEnvelope(raw, {
      keys: this.keys,
      allowNonProductionKeys: this.allowNonProductionKeys,
    });
    if (!verified.ok) return this.statusFromVerificationFailure(verified, now);

    const bindingMismatch = this.bindingMismatchReason(verified.payload);
    if (bindingMismatch !== null) return this.invalidStatus(bindingMismatch, now);

    if (Date.parse(verified.payload.expiresAt) <= now.getTime()) {
      return this.payloadStatus('expired', verified.payload, 'License is expired.', now, false);
    }

    if (clock.rollback) {
      return this.payloadStatus(
        'degraded',
        verified.payload,
        'System clock moved backward beyond the allowed tolerance.',
        now,
        true,
      );
    }

    return this.payloadStatus('licensed', verified.payload, null, now, false);
  }

  private async readCandidateFile(filePath: string): Promise<string> {
    if (!path.isAbsolute(filePath)) throw new Error('License path must be absolute.');
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('License path is not a file.');
    if (stat.size > MAX_LICENSE_BYTES) throw new Error('License file is too large.');
    return fs.readFile(filePath, 'utf-8');
  }

  private async readStoredEntitlement(): Promise<string | null> {
    try {
      const stat = await fs.stat(this.entitlementFile);
      if (!stat.isFile() || stat.size > MAX_LICENSE_BYTES) return null;
      return await fs.readFile(this.entitlementFile, 'utf-8');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return null;
      return null;
    }
  }

  private async observeClock(): Promise<ClockObservation> {
    const now = this.nowFn();
    const currentMs = now.getTime();
    const previous = await this.readState();
    const previousMs = previous.lastSeenAt ? Date.parse(previous.lastSeenAt) : Number.NaN;
    const rollback =
      Number.isFinite(previousMs) && currentMs + CLOCK_ROLLBACK_TOLERANCE_MS < previousMs;

    if (!rollback && (!Number.isFinite(previousMs) || currentMs > previousMs)) {
      await this.writeState({ version: 1, lastSeenAt: now.toISOString() });
    }

    return { now, rollback };
  }

  private async readState(): Promise<LicenseStateFile> {
    try {
      const raw = await fs.readFile(this.stateFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<LicenseStateFile>;
      if (parsed.version === 1) return { version: 1, lastSeenAt: parsed.lastSeenAt };
    } catch {
      /* fall through */
    }
    return { version: 1 };
  }

  private async writeState(state: LicenseStateFile): Promise<void> {
    await this.serializedWrite(async () => {
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const tmp = `${this.stateFile}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(state, null, 2), { encoding: 'utf-8', mode: 0o600 });
      await fs.rename(tmp, this.stateFile);
    });
  }

  private serializedWrite(work: () => Promise<void>): Promise<void> {
    this.writeLock = this.writeLock.then(work, work);
    return this.writeLock;
  }

  private emptyStatus(
    status: LicenseStatusT['status'],
    reason: string | null,
    now: Date,
    degraded: boolean,
  ): LicenseStatusT {
    return {
      status,
      edition: 'community',
      licenseKind: null,
      managedRequired: this.managedPolicy.required,
      enforcementSource: this.managedPolicy.source,
      licenseId: null,
      customer: null,
      expiresAt: null,
      features: [],
      reason,
      lastCheckedAt: now.toISOString(),
      degraded,
    };
  }

  private invalidStatus(reason: string, now: Date): LicenseStatusT {
    return this.emptyStatus('invalid', reason, now, false);
  }

  private statusFromVerificationFailure(
    failure: Exclude<LicenseVerificationResult, { readonly ok: true }>,
    now: Date,
  ): LicenseStatusT {
    return this.invalidStatus(failure.message, now);
  }

  private bindingMismatchReason(payload: LicenseEntitlementPayloadT): string | null {
    const binding = payload.binding;
    if (binding === undefined || binding.mode === 'none') return null;

    const expectedSiteId = this.managedPolicy.siteId;
    if (
      (binding.mode === 'site' || binding.mode === 'site-or-machine') &&
      binding.siteId !== undefined &&
      expectedSiteId !== undefined &&
      binding.siteId === expectedSiteId
    ) {
      return null;
    }

    if (binding.mode === 'site' || binding.mode === 'site-or-machine') {
      return 'License binding does not match this package site.';
    }

    return 'License binding mode is not supported by this package.';
  }

  private payloadStatus(
    status: LicenseStatusT['status'],
    payload: LicenseEntitlementPayloadT,
    reason: string | null,
    now: Date,
    degraded: boolean,
  ): LicenseStatusT {
    return {
      status,
      edition: payload.edition,
      licenseKind: payload.licenseKind,
      managedRequired: this.managedPolicy.required,
      enforcementSource: this.managedPolicy.source,
      licenseId: payload.licenseId,
      customer: payload.customer,
      expiresAt: payload.expiresAt,
      features: [...payload.features],
      reason,
      lastCheckedAt: now.toISOString(),
      degraded,
    };
  }
}

export const licenseManager = new LicenseManager({ managedPolicy: loadManagedLicensePolicy() });
