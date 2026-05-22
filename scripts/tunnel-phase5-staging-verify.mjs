#!/usr/bin/env node
/**
 * Phase 5 — verify full E2E tunnel against a running xopc gateway (ACME + TLS + frpc https).
 *
 * Prerequisites:
 * - Gateway running with tunnel connected and `tunnel.e2e.enabled`
 * - Broker DNS API configured (Dynadot) for ACME DNS-01
 * - frps `vhostHTTPSPort` reachable from this machine (default 8443)
 *
 * Env:
 *   GATEWAY_URL          default http://127.0.0.1:18790
 *   GATEWAY_TOKEN        required (gateway Bearer token)
 *   FRP_VHOST_HTTPS_PORT default 8443
 *   EXPECT_STAGING_CA    optional "true"|"false" — auto from cert-status e2e.staging when omitted
 */

import { connect as tlsConnect } from 'node:tls';
import { Agent as HttpsAgent, get as httpsGet } from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';

const GATEWAY_URL = (process.env.GATEWAY_URL ?? 'http://127.0.0.1:18790').replace(/\/+$/, '');
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN?.trim();
const HTTPS_PORT = Number(process.env.FRP_VHOST_HTTPS_PORT ?? '8443');

function log(step, msg) {
  console.log(`[phase5] ${step}: ${msg}`);
}

function fail(msg) {
  console.error(`[phase5] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[phase5] OK: ${msg}`);
}

async function gatewayJson(path) {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(`${path}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

function fetchPeerCert(host, port) {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect(
      { host, port, servername: host, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert);
      },
    );
    socket.setTimeout(15_000, () => {
      socket.destroy();
      reject(new Error(`TLS timeout ${host}:${port}`));
    });
    socket.on('error', reject);
  });
}

async function fetchPeerCertWithRetry(host, port, attempts = 10) {
  let lastErr = '';
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchPeerCert(host, port);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      await sleep(1_500);
    }
  }
  throw new Error(lastErr || 'TLS probe failed');
}

const insecureAgent = new HttpsAgent({ rejectUnauthorized: false });

function httpsGetJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      {
        agent: insecureAgent,
        timeout: 20_000,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('HTTP timeout')));
    req.on('error', reject);
  });
}

function certMatchesHost(cert, host) {
  const cn = cert.subject?.CN ?? '';
  if (cn === host) return true;
  const san = cert.subjectaltname ?? '';
  return san.includes(`DNS:${host}`);
}

function isStagingIssuer(cert) {
  const issuer = JSON.stringify(cert.issuer ?? {});
  return /staging|fake le/i.test(issuer);
}

async function main() {
  if (!GATEWAY_TOKEN) fail('Set GATEWAY_TOKEN to your gateway Bearer token');

  log('gateway', GATEWAY_URL);
  const status = await gatewayJson('/api/tunnel/status');
  if (status.state !== 'connected' || !status.publicUrl) {
    fail(`Tunnel not connected (state=${status.state}). Start remote access first.`);
  }
  ok(`Tunnel connected: ${status.publicUrl}`);

  const certStatus = await gatewayJson('/api/tunnel/cert-status');
  if (certStatus.renewalFailed) {
    fail(`Certificate renewal failed: ${certStatus.lastRenewalError ?? 'unknown'}`);
  }
  if (!certStatus.domain || certStatus.status === 'no_cert') {
    fail('No tunnel certificate on gateway — check tunnel.e2e and ACME/DNS');
  }
  ok(`Gateway cert: ${certStatus.domain} (${certStatus.status}, expires ${certStatus.expiresAt})`);

  const expectStaging =
    process.env.EXPECT_STAGING_CA === 'true'
      ? true
      : process.env.EXPECT_STAGING_CA === 'false'
        ? false
        : Boolean(certStatus.e2e?.staging);

  const publicHost = new URL(status.publicUrl).hostname;
  if (certStatus.domain !== publicHost) {
    fail(`Cert domain mismatch: cert=${certStatus.domain} publicUrl host=${publicHost}`);
  }

  const passthroughUrl = `https://${publicHost}:${HTTPS_PORT}/api/health`;
  log('probe', `TLS passthrough: ${passthroughUrl}`);

  const peerCert = await fetchPeerCertWithRetry(publicHost, HTTPS_PORT);
  if (!certMatchesHost(peerCert, publicHost)) {
    fail(`TLS cert does not match ${publicHost} (CN=${peerCert.subject?.CN})`);
  }
  ok(`Passthrough port presents cert for ${publicHost}`);

  if (expectStaging && !isStagingIssuer(peerCert)) {
    fail('Expected Let\'s Encrypt staging issuer but peer cert looks like production');
  }
  if (!expectStaging && isStagingIssuer(peerCert)) {
    fail('Production check but peer cert is staging CA — set tunnel.e2e.staging=false');
  }
  ok(expectStaging ? 'Staging CA confirmed' : 'Production CA (non-staging) confirmed');

  const health = await httpsGetJson(passthroughUrl, GATEWAY_TOKEN);
  if (health.status !== 'ok') fail(`Unexpected health payload: ${JSON.stringify(health)}`);
  ok('Authenticated /api/health reachable through E2E passthrough');

  const p0Cert = await fetchPeerCert(publicHost, 443).catch(() => null);
  if (p0Cert && certMatchesHost(p0Cert, publicHost) && peerCert.fingerprint256 === p0Cert.fingerprint256) {
    log('note', 'Port :443 presents same cert as passthrough — P0 may already be cut over');
  } else if (p0Cert) {
    ok(`P0 :443 still distinct (CN=${p0Cert.subject?.CN ?? '?'}) — safe parallel with :${HTTPS_PORT}`);
  }

  const report = {
    passed: true,
    publicUrl: status.publicUrl,
    certDomain: certStatus.domain,
    passthroughPort: HTTPS_PORT,
    staging: expectStaging,
    certStatus: certStatus.status,
    daysUntilExpiry: certStatus.daysUntilExpiry,
  };
  console.log(JSON.stringify(report, null, 2));
  ok('Phase 5 staging E2E verification passed');
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
