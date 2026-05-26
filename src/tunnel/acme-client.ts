import { createHash } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Agent, fetch as undiciFetch, type RequestInit } from 'undici';

import { resolveStateDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import type { TunnelBrokerClient } from './broker-client.js';
import type { TunnelAcmeProgressStep } from './tunnel-types.js';
import {
  base64url,
  ensureEcAccountKeyPem,
  exportJwkFromPrivateKeyPem,
  getCertExpiryFromPem,
  jwkThumbprint,
  signAcmeJws,
} from './acme-crypto.js';
import { generateDomainCsr } from './acme-csr.js';

const log = createLogger('TunnelACME');

const ACME_DIRECTORY = {
  production: 'https://acme-v02.api.letsencrypt.org/directory',
  staging: 'https://acme-staging-v02.api.letsencrypt.org/directory',
} as const;

const ACME_FETCH_TIMEOUT_MS = 30_000;
const ACME_FETCH_RETRIES = 4;

const acmeDispatcher = new Agent({
  connect: { timeout: ACME_FETCH_TIMEOUT_MS },
});

/** Public resolvers — LE validators use global DNS, not the host's stale cache. */
export const ACME_DNS_RESOLVERS = ['8.8.8.8', '1.1.1.1', '9.9.9.9'] as const;

/** Consecutive consensus rounds required before trusting DNS propagation. */
const ACME_DNS_CONSENSUS_ROUNDS = 2;

/** Minimum time after publishing TXT before accepting consensus (Dynadot ~60s). */
const ACME_DNS_MIN_PROPAGATION_MS = 30_000;

/** Hold consensus this long before submitting (LE secondary validation). */
const ACME_DNS_STABLE_MS = 30_000;

/** Poll interval while waiting for DNS. */
const ACME_DNS_POLL_INTERVAL_MS = 5_000;

/** Max time to wait for DNS consensus (first + stable phases). */
const ACME_DNS_TIMEOUT_MS = 240_000;

/** Retry whole DNS-01 attempt when LE reports secondary validation failures. */
const ACME_DNS_ATTEMPTS = 2;

/** Pause between ACME DNS-01 retries. */
const ACME_DNS_RETRY_DELAY_MS = 45_000;

export type AcmeDnsTxtProbe = {
  resolver: string;
  values: string[];
  error?: string;
};

async function resolveAcmeDnsTxtFromResolver(fqdn: string, resolver: string): Promise<string[]> {
  const dns = new Resolver();
  dns.setServers([resolver]);
  const records = await dns.resolveTxt(fqdn);
  return records.map((parts) => parts.join(''));
}

/** Query each public resolver independently (Node tries setServers in order — not sufficient for LE). */
export async function probeAcmeDnsTxtAllResolvers(fqdn: string): Promise<AcmeDnsTxtProbe[]> {
  return Promise.all(
    ACME_DNS_RESOLVERS.map(async (resolver) => {
      try {
        const values = await resolveAcmeDnsTxtFromResolver(fqdn, resolver);
        return { resolver, values };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { resolver, values: [] as string[], error: errorMessage };
      }
    }),
  );
}

export function allAcmeDnsResolversHaveTxt(probes: AcmeDnsTxtProbe[], expectedValue: string): boolean {
  return (
    probes.length > 0 &&
    probes.every((probe) => probe.values.some((value) => value === expectedValue))
  );
}

function summarizeAcmeDnsProbes(probes: AcmeDnsTxtProbe[]): string {
  return probes
    .map((probe) => {
      const seen = probe.values.join(', ') || probe.error || 'none';
      return `${probe.resolver}=${seen}`;
    })
    .join('; ');
}

export type AcmeConfig = {
  broker: TunnelBrokerClient;
  tunnelId: string;
  tunnelToken: string;
  subdomain: string;
  frpSubdomainHost: string;
  staging?: boolean;
  onProgress?: (step: TunnelAcmeProgressStep) => void;
};

export type AcmeCertResult = {
  certPem: string;
  keyPem: string;
  domain: string;
  expiresAt: Date;
  issuedAt: Date;
};

type AcmeDirectory = {
  newNonce: string;
  newAccount: string;
  newOrder: string;
};

type AcmeAccount = {
  url: string;
  jwk: ReturnType<typeof exportJwkFromPrivateKeyPem>;
  keyPem: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeFqdn(fqdn: string): string {
  return fqdn.trim().replace(/\.$/, '').toLowerCase();
}

/** LE always validates `_acme-challenge.{domain}` (RFC 8555 §8.4). */
export function resolveAcmeChallengeFqdn(domain: string): string {
  return `_acme-challenge.${domain}`;
}

function formatValidationRecordEntry(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const obj = entry as Record<string, unknown>;
    if (typeof obj.detail === 'string') return obj.detail;
    const hostname = typeof obj.hostname === 'string' ? obj.hostname : '';
    const error = typeof obj.error === 'string' ? obj.error : '';
    if (hostname && error) return `${hostname}: ${error}`;
    if (error) return error;
    try {
      return JSON.stringify(entry);
    } catch {
      return String(entry);
    }
  }
  return String(entry);
}

export function formatAcmeDnsChallengeInvalidError(
  fqdn: string,
  data: { error?: { detail?: string; type?: string }; validationRecord?: unknown[] },
): string {
  const parts = [`ACME DNS-01 challenge invalid for ${fqdn}`];
  if (data.error?.detail) parts.push(data.error.detail);
  else if (data.error?.type) parts.push(data.error.type);
  if (data.validationRecord?.length) {
    parts.push(
      `validation: ${data.validationRecord.map(formatValidationRecordEntry).join('; ')}`,
    );
  }
  return parts.join(' — ');
}

export function isRetryableAcmeDnsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /secondary validation/i.test(message) ||
    /DNS TXT not visible on all resolvers/i.test(message) ||
    /ACME DNS-01 challenge timed out/i.test(message)
  );
}

export type WaitForDnsTxtOptions = {
  minPropagationMs?: number;
  stableMs?: number;
  timeoutMs?: number;
  consensusRounds?: number;
  pollIntervalMs?: number;
  probe?: (fqdn: string) => Promise<AcmeDnsTxtProbe[]>;
  sleep?: (ms: number) => Promise<void>;
};

/** Poll public resolvers until TXT is stable — no blind initial sleep. */
export async function waitForDnsTxtConsensus(
  fqdn: string,
  expectedValue: string,
  opts?: WaitForDnsTxtOptions,
): Promise<void> {
  const minPropagationMs = opts?.minPropagationMs ?? ACME_DNS_MIN_PROPAGATION_MS;
  const stableMs = opts?.stableMs ?? ACME_DNS_STABLE_MS;
  const timeoutMs = opts?.timeoutMs ?? ACME_DNS_TIMEOUT_MS;
  const consensusRounds = opts?.consensusRounds ?? ACME_DNS_CONSENSUS_ROUNDS;
  const pollIntervalMs = opts?.pollIntervalMs ?? ACME_DNS_POLL_INTERVAL_MS;
  const probe = opts?.probe ?? probeAcmeDnsTxtAllResolvers;
  const delay = opts?.sleep ?? sleep;

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let lastProbes: AcmeDnsTxtProbe[] = [];
  let consensusStreak = 0;
  let stableSince: number | null = null;

  while (Date.now() < deadline) {
    lastProbes = await probe(fqdn);
    const elapsedMs = Date.now() - startedAt;
    const hasConsensus =
      elapsedMs >= minPropagationMs &&
      allAcmeDnsResolversHaveTxt(lastProbes, expectedValue);

    if (hasConsensus) {
      consensusStreak += 1;
      if (consensusStreak >= consensusRounds) {
        if (stableMs <= 0) {
          log.info(
            {
              fqdn,
              resolvers: ACME_DNS_RESOLVERS,
              elapsedMs,
              probes: summarizeAcmeDnsProbes(lastProbes),
            },
            'DNS-01 TXT visible on all public resolvers',
          );
          return;
        }
        if (stableSince === null) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) {
          const finalProbes = await probe(fqdn);
          if (allAcmeDnsResolversHaveTxt(finalProbes, expectedValue)) {
            log.info(
              {
                fqdn,
                resolvers: ACME_DNS_RESOLVERS,
                elapsedMs: Date.now() - startedAt,
                stableMs,
                probes: summarizeAcmeDnsProbes(finalProbes),
              },
              'DNS-01 TXT stable on all public resolvers',
            );
            return;
          }
          stableSince = null;
          consensusStreak = 0;
        }
      }
    } else {
      consensusStreak = 0;
      stableSince = null;
    }
    await delay(pollIntervalMs);
  }

  throw new Error(
    `DNS TXT not visible on all resolvers for ${fqdn} (expected ${expectedValue}; last probe: ${summarizeAcmeDnsProbes(lastProbes)})`,
  );
}

function getAcmeDir(): string {
  const dir = join(resolveStateDir(), 'tunnel', 'acme');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function loadAccountKeyPem(): string {
  const keyPath = join(getAcmeDir(), 'account-key.pem');
  if (existsSync(keyPath)) {
    return readFileSync(keyPath, 'utf8');
  }
  const pem = ensureEcAccountKeyPem();
  writeFileSync(keyPath, pem, { mode: 0o600 });
  return pem;
}

function accountUrlPath(staging: boolean): string {
  return join(getAcmeDir(), staging ? 'account-url-staging.txt' : 'account-url-production.txt');
}

function loadAccountUrl(staging: boolean): string {
  const path = accountUrlPath(staging);
  if (existsSync(path)) {
    return readFileSync(path, 'utf8').trim();
  }
  // Legacy single file — treat as production only.
  const legacyPath = join(getAcmeDir(), 'account-url.txt');
  if (!staging && existsSync(legacyPath)) {
    const legacyUrl = readFileSync(legacyPath, 'utf8').trim();
    if (legacyUrl.startsWith('http')) {
      writeFileSync(path, legacyUrl, 'utf8');
      return legacyUrl;
    }
  }
  return '';
}

function saveAccountUrl(staging: boolean, url: string): void {
  writeFileSync(accountUrlPath(staging), url, 'utf8');
}

function accountUrlMatchesCa(accountUrl: string, staging: boolean): boolean {
  const host = staging ? 'acme-staging-v02.api.letsencrypt.org' : 'acme-v02.api.letsencrypt.org';
  try {
    return new URL(accountUrl).host === host;
  } catch {
    return false;
  }
}

function resolveCertDomain(subdomain: string, frpSubdomainHost: string): string {
  return `${subdomain}.${frpSubdomainHost}`;
}

async function acmeFetch(url: string, init?: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= ACME_FETCH_RETRIES; attempt++) {
    try {
      return await undiciFetch(url, {
        ...init,
        dispatcher: acmeDispatcher,
        signal: AbortSignal.timeout(ACME_FETCH_TIMEOUT_MS + 5_000),
      });
    } catch (err) {
      lastErr = err;
      if (attempt < ACME_FETCH_RETRIES) {
        log.warn({ url, attempt, err }, 'ACME fetch failed, retrying');
        await sleep(2_000 * attempt);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function acmeFetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data: T; nonce?: string; location?: string | null }> {
  const res = await acmeFetch(url, init);
  const replayNonce = res.headers.get('replay-nonce') ?? undefined;
  const location = res.headers.get('location');

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ACME HTTP ${res.status} ${url}: ${body.slice(0, 300)}`);
  }

  if (res.status === 204) {
    return { data: {} as T, nonce: replayNonce, location };
  }

  const data = (await res.json()) as T;
  return { data, nonce: replayNonce, location };
}

async function acmeSignedPost<T>(
  url: string,
  account: AcmeAccount,
  nonce: string,
  payload: unknown,
): Promise<{ data: T; nonce?: string; location?: string | null }> {
  const useKid = account.url.startsWith('http');
  const jws = signAcmeJws({
    privateKeyPem: account.keyPem,
    url,
    nonce,
    payload,
    kid: useKid ? account.url : undefined,
    jwk: useKid ? undefined : account.jwk,
  });

  return acmeFetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/jose+json' },
    body: JSON.stringify(jws),
  });
}

async function downloadCertificate(certUrl: string, account: AcmeAccount, directory: AcmeDirectory): Promise<string> {
  const nonce = await getNonce(directory);
  const jws = signAcmeJws({
    privateKeyPem: account.keyPem,
    url: certUrl,
    nonce,
    payload: null,
    kid: account.url,
  });
  const res = await acmeFetch(certUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/jose+json', Accept: 'application/pem-certificate-chain' },
    body: JSON.stringify(jws),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ACME cert download failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.text();
}

async function getDirectory(staging: boolean): Promise<AcmeDirectory> {
  const url = staging ? ACME_DIRECTORY.staging : ACME_DIRECTORY.production;
  const { data } = await acmeFetchJson<AcmeDirectory>(url);
  return data;
}

async function getNonce(directory: AcmeDirectory): Promise<string> {
  const res = await acmeFetch(directory.newNonce, { method: 'HEAD' });
  const nonce = res.headers.get('replay-nonce');
  if (!nonce) throw new Error('ACME CA did not return replay-nonce');
  return nonce;
}

async function ensureAccount(
  directory: AcmeDirectory,
  keyPem: string,
  staging: boolean,
): Promise<AcmeAccount> {
  const jwk = exportJwkFromPrivateKeyPem(keyPem);
  let accountUrl = loadAccountUrl(staging);
  if (accountUrl && !accountUrlMatchesCa(accountUrl, staging)) {
    accountUrl = '';
  }

  // new-acct MUST use embedded jwk (RFC 8555 §7.3.1). LE returns an existing account when the JWK matches.
  const nonce = await getNonce(directory);
  const result = await acmeSignedPost<{ status?: string }>(
    directory.newAccount,
    { url: 'new', jwk, keyPem },
    nonce,
    { termsOfServiceAgreed: true },
  );

  if (result.location) {
    accountUrl = result.location;
    saveAccountUrl(staging, accountUrl);
  }
  if (!accountUrl) throw new Error('ACME account registration failed (no account URL)');

  return { url: accountUrl, jwk, keyPem };
}

async function pollChallengeReady(
  challengeUrl: string,
  account: AcmeAccount,
  directory: AcmeDirectory,
  challengeFqdn: string,
): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await sleep(i === 0 ? 5_000 : 2_000);
    const nonce = await getNonce(directory);
    // POST-as-GET (payload null) — must not POST `{}` again; that re-submits the challenge response.
    const { data } = await acmeSignedPost<{
      status?: string;
      error?: { type?: string; detail?: string };
      validationRecord?: unknown[];
    }>(challengeUrl, account, nonce, null);
    if (data.status === 'valid') return;
    if (data.status === 'invalid') {
      const message = formatAcmeDnsChallengeInvalidError(challengeFqdn, data);
      log.error({ challengeFqdn, error: data.error, validationRecord: data.validationRecord }, message);
      throw new Error(message);
    }
  }
  throw new Error(`ACME DNS-01 challenge timed out for ${challengeFqdn}`);
}

async function pollOrderValid(
  orderUrl: string,
  account: AcmeAccount,
  directory: AcmeDirectory,
): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const nonce = await getNonce(directory);
    const { data } = await acmeSignedPost<{ status?: string; certificate?: string }>(
      orderUrl,
      account,
      nonce,
      null,
    );
    if (data.status === 'valid' && data.certificate) return data.certificate;
    if (data.status === 'invalid') throw new Error('ACME order invalid');
    await sleep(2_000);
  }
  throw new Error('ACME order finalize timed out');
}

async function cleanupDnsChallengeRecord(
  broker: TunnelBrokerClient,
  tunnelId: string,
  tunnelToken: string,
  recordId: string,
): Promise<void> {
  await broker
    .cleanupDnsChallenge({ tunnelId, tunnelToken, recordId })
    .catch((err) => {
      log.warn({ err, recordId }, 'DNS cleanup failed (non-critical)');
    });
}

async function runDns01Attempt(params: {
  config: AcmeConfig;
  directory: AcmeDirectory;
  account: AcmeAccount;
  domain: string;
  challengeFqdn: string;
}): Promise<{ result: AcmeCertResult; recordId: string }> {
  const { config, directory, account, domain, challengeFqdn } = params;

  let nonce = await getNonce(directory);
  const orderResult = await acmeSignedPost<{ authorizations?: string[]; finalize?: string }>(
    directory.newOrder,
    account,
    nonce,
    { identifiers: [{ type: 'dns', value: domain }] },
  );
  const orderUrl = orderResult.location;
  if (!orderUrl) throw new Error('ACME newOrder missing order URL');

  const authzUrl = orderResult.data.authorizations?.[0];
  if (!authzUrl) throw new Error('ACME order missing authorization');

  nonce = await getNonce(directory);
  const authz = await acmeSignedPost<{
    challenges?: Array<{ type: string; url: string; token: string }>;
  }>(authzUrl, account, nonce, null);
  const challenge = authz.data.challenges?.find((c) => c.type === 'dns-01');
  if (!challenge) throw new Error('No DNS-01 challenge offered by CA');

  const thumbprint = jwkThumbprint(account.jwk);
  const keyAuth = `${challenge.token}.${thumbprint}`;
  const txtValue = base64url(createHash('sha256').update(keyAuth).digest());

  log.info({ fqdn: challengeFqdn, txtPreview: `${txtValue.slice(0, 8)}…` }, 'Setting DNS-01 challenge via Broker');
  config.onProgress?.('dns_challenge');
  const { recordId, fqdn } = await config.broker.setDnsChallenge({
    tunnelId: config.tunnelId,
    tunnelToken: config.tunnelToken,
    subdomain: config.subdomain,
    txtValue,
  });

  if (normalizeFqdn(fqdn) !== normalizeFqdn(challengeFqdn)) {
    log.warn(
      { brokerFqdn: fqdn, challengeFqdn, phase: 'acme_dns_fqdn_mismatch' },
      'Broker returned unexpected ACME challenge FQDN — polling canonical name for Let\'s Encrypt',
    );
  }

  try {
    config.onProgress?.('dns_propagation');
    await waitForDnsTxtConsensus(challengeFqdn, txtValue);

    nonce = await getNonce(directory);
    await acmeSignedPost(challenge.url, account, nonce, {});

    config.onProgress?.('ca_validation');
    await pollChallengeReady(challenge.url, account, directory, challengeFqdn);

    const { csrDer, keyPem } = generateDomainCsr(domain);
    const finalizeUrl = orderResult.data.finalize;
    if (!finalizeUrl) throw new Error('ACME order missing finalize URL');

    config.onProgress?.('issuing');
    nonce = await getNonce(directory);
    await acmeSignedPost(finalizeUrl, account, nonce, { csr: base64url(csrDer) });

    const certUrl = await pollOrderValid(orderUrl, account, directory);
    const certPem = await downloadCertificate(certUrl, account, directory);

    const firstCert = certPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
    if (!firstCert) throw new Error('ACME certificate PEM parse failed');

    const expiresAt = getCertExpiryFromPem(firstCert);
    log.info({ domain, expiresAt: expiresAt.toISOString() }, 'Certificate issued');

    await cleanupDnsChallengeRecord(config.broker, config.tunnelId, config.tunnelToken, recordId);

    return {
      recordId,
      result: {
        certPem: certPem.trim(),
        keyPem,
        domain,
        expiresAt,
        issuedAt: new Date(),
      },
    };
  } catch (err) {
    await cleanupDnsChallengeRecord(config.broker, config.tunnelId, config.tunnelToken, recordId);
    throw err;
  }
}

export async function requestCertificate(config: AcmeConfig): Promise<AcmeCertResult> {
  const staging = config.staging ?? false;
  const domain = resolveCertDomain(config.subdomain, config.frpSubdomainHost);
  const challengeFqdn = resolveAcmeChallengeFqdn(domain);

  log.info({ domain, staging }, 'Starting ACME certificate request');
  config.onProgress?.('checking');

  const directory = await getDirectory(staging);
  const accountKeyPem = loadAccountKeyPem();
  const account = await ensureAccount(directory, accountKeyPem, staging);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= ACME_DNS_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        log.warn({ domain, attempt, phase: 'acme_dns_retry' }, 'Retrying ACME DNS-01 after propagation delay');
        await sleep(ACME_DNS_RETRY_DELAY_MS);
      }
      const { result } = await runDns01Attempt({
        config,
        directory,
        account,
        domain,
        challengeFqdn,
      });
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < ACME_DNS_ATTEMPTS && isRetryableAcmeDnsError(err)) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.warn({ domain, attempt, errorMessage, phase: 'acme_dns_retryable' }, `ACME DNS-01 failed, will retry: ${errorMessage}`);
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
