/**
 * SSRF guard tests. Verifies that the production guard refuses to talk to
 * private addresses, IP literals, unsupported schemes, and out-of-allowlist
 * hostnames; and that tests can opt in via `allowPrivateNetwork: true`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SsrfBlockedError,
  assertSafeUrl,
  fetchWithTimeoutGuarded,
  isPrivateIpv4,
  isPrivateIpv6,
} from '../index.js';
import { startMockServer, type MockServerHandle } from '../test-helpers/mock-server.js';

describe('isPrivateIpv4 / isPrivateIpv6', () => {
  it('flags private IPv4 ranges', () => {
    expect(isPrivateIpv4('127.0.0.1')).toBe(true);
    expect(isPrivateIpv4('10.0.0.1')).toBe(true);
    expect(isPrivateIpv4('192.168.1.1')).toBe(true);
    expect(isPrivateIpv4('169.254.169.254')).toBe(true); // EC2 metadata
  });

  it('does not flag public IPv4', () => {
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateIpv4('1.1.1.1')).toBe(false);
  });

  it('flags loopback / link-local IPv6', () => {
    expect(isPrivateIpv6('::1')).toBe(true);
    expect(isPrivateIpv6('fe80::1')).toBe(true);
  });
});

describe('assertSafeUrl', () => {
  it('rejects unsupported schemes', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertSafeUrl('ftp://example.com')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejects private IP literals by default', async () => {
    await expect(assertSafeUrl('http://127.0.0.1:8080/whatever')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(assertSafeUrl('http://192.168.1.1/x')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('allows private IP literals when caller opts in', async () => {
    const result = await assertSafeUrl('http://127.0.0.1:8080/x', { allowPrivateNetwork: true });
    expect(result.resolvedIp).toBe('127.0.0.1');
    expect(result.family).toBe(4);
  });

  it('honors hostnameAllowlist', async () => {
    await expect(
      assertSafeUrl('http://127.0.0.1:8080/x', {
        allowPrivateNetwork: true,
        hostnameAllowlist: ['localhost'],
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);

    const ok = await assertSafeUrl('http://127.0.0.1:8080/x', {
      allowPrivateNetwork: true,
      hostnameAllowlist: ['127.0.0.1'],
    });
    expect(ok.resolvedIp).toBe('127.0.0.1');
  });
});

describe('fetchWithTimeoutGuarded', () => {
  let server: MockServerHandle;

  beforeAll(async () => {
    server = await startMockServer(() => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    }));
  });

  afterAll(async () => {
    await server.close();
  });

  it('blocks requests to mock server when allowPrivateNetwork=false (default)', async () => {
    await expect(
      fetchWithTimeoutGuarded(`${server.baseUrl}/test`, {
        timeoutMs: 5_000,
        label: 'ssrf-test',
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('allows mock server requests when allowPrivateNetwork=true', async () => {
    const res = await fetchWithTimeoutGuarded(`${server.baseUrl}/test`, {
      timeoutMs: 5_000,
      label: 'ssrf-test',
      allowPrivateNetwork: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('aborts when the configured timeout fires before the response', async () => {
    server.setHandler(() => ({
      status: 200,
      delayMs: 200,
      body: 'late',
    }));
    await expect(
      fetchWithTimeoutGuarded(`${server.baseUrl}/slow`, {
        timeoutMs: 50,
        label: 'ssrf-test',
        allowPrivateNetwork: true,
      }),
    ).rejects.toThrow(/abort/i);
  });
});
