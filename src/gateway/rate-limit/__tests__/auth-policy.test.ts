import { describe, expect, it } from 'vitest';

import { resolveAuthTracking, buildBrowserOriginKey } from '../auth-policy.js';

const ENABLED = { enabled: true, exemptLoopback: true };
const DISABLED = { enabled: false, exemptLoopback: true };
const NO_EXEMPTION = { enabled: true, exemptLoopback: false };

describe('resolveAuthTracking', () => {
  it('returns exempt when limiter is disabled', () => {
    const t = resolveAuthTracking({ clientIp: '1.2.3.4', cfg: DISABLED });
    expect(t.exempt).toBe(true);
  });

  it('exempts loopback IPs when exemptLoopback is true', () => {
    expect(resolveAuthTracking({ clientIp: '127.0.0.1', cfg: ENABLED }).exempt).toBe(true);
    expect(resolveAuthTracking({ clientIp: '::1', cfg: ENABLED }).exempt).toBe(true);
  });

  it('tracks loopback IPs when exemptLoopback is false', () => {
    const t = resolveAuthTracking({ clientIp: '127.0.0.1', cfg: NO_EXEMPTION });
    expect(t.exempt).toBe(false);
    if (!t.exempt) expect(t.key).toBe('127.0.0.1');
  });

  it('switches to browser-origin key when Origin header is present', () => {
    const t = resolveAuthTracking({
      clientIp: '203.0.113.1',
      origin: 'https://app.example.com',
      cfg: ENABLED,
    });
    expect(t.exempt).toBe(false);
    if (!t.exempt) {
      expect(t.key).toBe(buildBrowserOriginKey('https://app.example.com', '203.0.113.1'));
    }
  });

  it('exempts loopback browser origin when client IP is also loopback', () => {
    const t = resolveAuthTracking({
      clientIp: '127.0.0.1',
      origin: 'http://localhost:18790',
      cfg: ENABLED,
    });
    expect(t.exempt).toBe(true);
  });

  it('exempts loopback browser origin when client IP is unknown (Electron embed)', () => {
    const t = resolveAuthTracking({
      clientIp: 'unknown',
      origin: 'http://127.0.0.1:28790',
      cfg: ENABLED,
    });
    expect(t.exempt).toBe(true);
  });

  it('still tracks non-loopback browser origins coming from a loopback IP', () => {
    // Defense-in-depth: a malicious page can lie in Origin header, but the
    // pair (origin, ip) is what we bucket on.
    const t = resolveAuthTracking({
      clientIp: '127.0.0.1',
      origin: 'http://evil.example.com',
      cfg: ENABLED,
    });
    expect(t.exempt).toBe(false);
  });

  it('normalizes browser-origin key (lowercased, trimmed)', () => {
    const t = resolveAuthTracking({
      clientIp: '203.0.113.1',
      origin: '  HTTP://App.Example.com  ',
      cfg: ENABLED,
    });
    expect(t.exempt).toBe(false);
    if (!t.exempt) {
      expect(t.key).toBe('browser-origin:http://app.example.com|203.0.113.1');
    }
  });
});
