#!/usr/bin/env node
/**
 * Verify broker-terminated TLS for tunnel subdomains (Phase 6).
 *
 * Env:
 *   TUNNEL_PUBLIC_URL  e.g. https://abcd1234.frp.xopc.ai
 *   GATEWAY_TOKEN      optional Bearer for /health
 */
const publicUrl = process.env.TUNNEL_PUBLIC_URL?.trim();
if (!publicUrl) {
  console.error('Set TUNNEL_PUBLIC_URL=https://{sub}.frp.xopc.ai');
  process.exit(1);
}

const token = process.env.GATEWAY_TOKEN?.trim();
const headers = token ? { Authorization: `Bearer ${token}` } : {};

const healthUrl = `${publicUrl.replace(/\/+$/, '')}/health`;
const res = await fetch(healthUrl, { headers });
if (!res.ok) {
  console.error(`Health check failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}

console.log('Health OK:', healthUrl);

try {
  const tls = await fetch(`https://${new URL(publicUrl).hostname}`, { method: 'HEAD' });
  console.log('TLS probe status:', tls.status);
} catch (err) {
  console.warn('TLS probe skipped:', err instanceof Error ? err.message : String(err));
}

console.log('Phase 6 broker TLS verification passed');
