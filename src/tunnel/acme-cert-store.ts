import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { resolveStateDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import { requestCertificate, type AcmeConfig, type AcmeCertResult } from './acme-client.js';

const log = createLogger('TunnelCert');

const RENEWAL_THRESHOLD_DAYS = 30;
const RENEWAL_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export type StoredCert = {
  certPem: string;
  keyPem: string;
  domain: string;
  issuedAt: string;
  expiresAt: string;
};

let renewalTimer: ReturnType<typeof setInterval> | null = null;
let lastRenewalError: string | null = null;
let lastRenewalErrorAt: string | null = null;

type CertStatusListener = (summary: ReturnType<typeof getCertStatusSummary>) => void;
const certStatusListeners = new Set<CertStatusListener>();

export function subscribeCertStatus(listener: CertStatusListener): () => void {
  certStatusListeners.add(listener);
  return () => certStatusListeners.delete(listener);
}

function emitCertStatusChange(): void {
  const summary = getCertStatusSummary();
  for (const listener of certStatusListeners) {
    try {
      listener(summary);
    } catch (err) {
      log.warn({ err, phase: 'cert_status_listener' }, 'Cert status listener failed');
    }
  }
}

export function recordRenewalFailure(err: unknown): void {
  const errorMessage = err instanceof Error ? err.message : String(err);
  lastRenewalError = errorMessage;
  lastRenewalErrorAt = new Date().toISOString();
  log.error({ err, errorMessage, phase: 'cert_renewal' }, `Tunnel certificate renewal failed: ${errorMessage}`);
  emitCertStatusChange();
}

export function clearRenewalFailure(): void {
  if (!lastRenewalError && !lastRenewalErrorAt) return;
  lastRenewalError = null;
  lastRenewalErrorAt = null;
  emitCertStatusChange();
}

function getCertDir(): string {
  const dir = join(resolveStateDir(), 'tunnel', 'cert');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadStoredCert(): StoredCert | null {
  const metaPath = join(getCertDir(), 'cert-meta.json');
  if (!existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as StoredCert;
    const certPath = join(getCertDir(), 'fullchain.pem');
    const keyPath = join(getCertDir(), 'privkey.pem');
    if (!existsSync(certPath) || !existsSync(keyPath)) return null;
    meta.certPem = readFileSync(certPath, 'utf8');
    meta.keyPem = readFileSync(keyPath, 'utf8');
    return meta;
  } catch {
    return null;
  }
}

export function needsRenewal(cert: StoredCert): boolean {
  const days = (new Date(cert.expiresAt).getTime() - Date.now()) / 86_400_000;
  return days <= RENEWAL_THRESHOLD_DAYS;
}

function storedCertIsStaging(certPem: string): boolean {
  return certPem.includes('(STAGING)');
}

function storedCertMatchesAcmeConfig(existing: StoredCert, acmeConfig: AcmeConfig): boolean {
  const staging = acmeConfig.staging ?? false;
  return storedCertIsStaging(existing.certPem) === staging;
}

export function saveCert(result: AcmeCertResult): void {
  const dir = getCertDir();
  writeFileSync(join(dir, 'fullchain.pem'), result.certPem, { mode: 0o644 });
  writeFileSync(join(dir, 'privkey.pem'), result.keyPem, { mode: 0o600 });
  writeFileSync(
    join(dir, 'cert-meta.json'),
    JSON.stringify({
      domain: result.domain,
      issuedAt: result.issuedAt.toISOString(),
      expiresAt: result.expiresAt.toISOString(),
    }),
    'utf8',
  );
  log.info({ domain: result.domain, expiresAt: result.expiresAt.toISOString() }, 'Certificate saved');
  clearRenewalFailure();
}

export async function ensureValidCert(acmeConfig: AcmeConfig): Promise<StoredCert> {
  const existing = loadStoredCert();
  const expectedDomain = `${acmeConfig.subdomain}.${acmeConfig.frpSubdomainHost}`;
  if (
    existing &&
    existing.domain === expectedDomain &&
    !needsRenewal(existing) &&
    storedCertMatchesAcmeConfig(existing, acmeConfig)
  ) {
    return existing;
  }

  if (existing && !storedCertMatchesAcmeConfig(existing, acmeConfig)) {
    log.info(
      { domain: existing.domain, staging: acmeConfig.staging ?? false },
      'Certificate CA mode mismatch, re-issuing',
    );
  } else if (existing) {
    log.info({ domain: existing.domain }, 'Certificate expiring soon, renewing');
  } else {
    log.info({ subdomain: acmeConfig.subdomain }, 'No certificate, requesting new one');
  }

  try {
    const result = await requestCertificate(acmeConfig);
    saveCert(result);
    return {
      certPem: result.certPem,
      keyPem: result.keyPem,
      domain: result.domain,
      issuedAt: result.issuedAt.toISOString(),
      expiresAt: result.expiresAt.toISOString(),
    };
  } catch (err) {
    recordRenewalFailure(err);
    throw err;
  }
}

export function startRenewalScheduler(acmeConfig: AcmeConfig, onRenewed: () => void): void {
  stopRenewalScheduler();
  renewalTimer = setInterval(() => {
    void (async () => {
      const cert = loadStoredCert();
      if (!cert || !needsRenewal(cert)) return;
      log.info({ domain: cert.domain }, 'Auto-renewing certificate');
      try {
        await ensureValidCert(acmeConfig);
        onRenewed();
      } catch {
        /* failure recorded in ensureValidCert */
      }
    })();
  }, RENEWAL_CHECK_INTERVAL_MS);
}

export function stopRenewalScheduler(): void {
  if (renewalTimer) {
    clearInterval(renewalTimer);
    renewalTimer = null;
  }
}

export function getCertStatusSummary(): {
  status: 'no_cert' | 'healthy' | 'expiring_soon' | 'critical' | 'renewal_failed';
  domain: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  autoRenewal: boolean;
  renewalFailed: boolean;
  lastRenewalError: string | null;
  lastRenewalErrorAt: string | null;
} {
  const cert = loadStoredCert();
  if (!cert) {
    return {
      status: lastRenewalError ? 'renewal_failed' : 'no_cert',
      domain: null,
      issuedAt: null,
      expiresAt: null,
      daysUntilExpiry: null,
      autoRenewal: true,
      renewalFailed: Boolean(lastRenewalError),
      lastRenewalError,
      lastRenewalErrorAt,
    };
  }
  const daysUntilExpiry = Math.floor(
    (new Date(cert.expiresAt).getTime() - Date.now()) / 86_400_000,
  );
  let status: 'healthy' | 'expiring_soon' | 'critical' | 'renewal_failed' = 'healthy';
  if (lastRenewalError) status = 'renewal_failed';
  else if (daysUntilExpiry <= 7) status = 'critical';
  else if (daysUntilExpiry <= 30) status = 'expiring_soon';

  return {
    status,
    domain: cert.domain,
    issuedAt: cert.issuedAt,
    expiresAt: cert.expiresAt,
    daysUntilExpiry,
    autoRenewal: true,
    renewalFailed: Boolean(lastRenewalError),
    lastRenewalError,
    lastRenewalErrorAt,
  };
}

/** @internal */
export function stopRenewalSchedulerForTests(): void {
  stopRenewalScheduler();
}

/** @internal */
export function resetCertStoreStateForTests(): void {
  stopRenewalScheduler();
  lastRenewalError = null;
  lastRenewalErrorAt = null;
  certStatusListeners.clear();
}
