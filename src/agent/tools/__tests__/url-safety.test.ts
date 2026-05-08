import { describe, it, expect } from 'vitest';

import {
  checkUrlSafety,
  assertUrlSafe,
  checkWebsiteBlocklist,
  cleanBase64Images,
} from '../url-safety.js';

// =============================================================================
// checkUrlSafety — SSRF protection
// =============================================================================
describe('checkUrlSafety', () => {
  it('allows public HTTPS URLs', () => {
    expect(checkUrlSafety('https://example.com/page')).toEqual({ safe: true });
    expect(checkUrlSafety('https://docs.python.org/3/')).toEqual({ safe: true });
  });

  it('allows public HTTP URLs', () => {
    expect(checkUrlSafety('http://example.com')).toEqual({ safe: true });
  });

  it('blocks non-HTTP schemes', () => {
    const result = checkUrlSafety('file:///etc/passwd');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/http/i);
  });

  it('blocks FTP scheme', () => {
    expect(checkUrlSafety('ftp://ftp.example.com').safe).toBe(false);
  });

  it('blocks invalid URLs', () => {
    expect(checkUrlSafety('not a url').safe).toBe(false);
  });

  it('blocks URLs with embedded credentials', () => {
    const result = checkUrlSafety('https://user:pass@example.com/');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/credential/i);
  });

  // Cloud metadata endpoints — always blocked
  it('blocks AWS metadata endpoint 169.254.169.254', () => {
    const result = checkUrlSafety('http://169.254.169.254/latest/meta-data/');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/cloud metadata/i);
  });

  it('blocks AWS ECS task metadata 169.254.170.2', () => {
    const result = checkUrlSafety('http://169.254.170.2/v2/credentials');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/cloud metadata|private/i);
  });

  it('blocks Alibaba Cloud metadata 100.100.100.200', () => {
    const result = checkUrlSafety('http://100.100.100.200/latest/meta-data/');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/cloud metadata/i);
  });

  it('blocks metadata.google.internal', () => {
    const result = checkUrlSafety('http://metadata.google.internal/computeMetadata/v1/');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/cloud metadata/i);
  });

  it('blocks metadata.goog', () => {
    const result = checkUrlSafety('http://metadata.goog/computeMetadata/v1/');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/cloud metadata/i);
  });

  // Private IP ranges
  it('blocks localhost', () => {
    expect(checkUrlSafety('http://localhost:8080/').safe).toBe(false);
    expect(checkUrlSafety('http://foo.localhost/').safe).toBe(false);
  });

  it('blocks 10.x.x.x (RFC 1918)', () => {
    expect(checkUrlSafety('http://10.0.0.1/').safe).toBe(false);
  });

  it('blocks 192.168.x.x (RFC 1918)', () => {
    expect(checkUrlSafety('http://192.168.1.1/').safe).toBe(false);
  });

  it('blocks 172.16-31.x.x (RFC 1918)', () => {
    expect(checkUrlSafety('http://172.16.0.1/').safe).toBe(false);
    expect(checkUrlSafety('http://172.31.255.255/').safe).toBe(false);
  });

  it('allows 172.32.x.x (outside RFC 1918 range)', () => {
    expect(checkUrlSafety('http://172.32.0.1/').safe).toBe(true);
  });

  it('blocks 127.x.x.x loopback', () => {
    expect(checkUrlSafety('http://127.0.0.1/').safe).toBe(false);
  });

  it('blocks CGNAT 100.64.x.x', () => {
    expect(checkUrlSafety('http://100.64.0.1/').safe).toBe(false);
    expect(checkUrlSafety('http://100.127.255.255/').safe).toBe(false);
  });

  it('blocks 169.254.x.x link-local', () => {
    expect(checkUrlSafety('http://169.254.1.1/').safe).toBe(false);
  });

  it('blocks .local and .internal hostnames', () => {
    expect(checkUrlSafety('http://myhost.local/').safe).toBe(false);
    expect(checkUrlSafety('http://service.internal/').safe).toBe(false);
  });

  it('blocks IPv6 loopback', () => {
    expect(checkUrlSafety('http://[::1]/').safe).toBe(false);
  });

  it('blocks IPv6 link-local', () => {
    expect(checkUrlSafety('http://[fe80::1]/').safe).toBe(false);
  });

  it('blocks IPv6 ULA', () => {
    expect(checkUrlSafety('http://[fd00::1]/').safe).toBe(false);
  });
});

describe('assertUrlSafe', () => {
  it('does not throw for safe URLs', () => {
    expect(() => assertUrlSafe('https://example.com')).not.toThrow();
  });

  it('throws for blocked URLs', () => {
    expect(() => assertUrlSafe('http://169.254.169.254/')).toThrow();
    expect(() => assertUrlSafe('http://localhost/')).toThrow();
  });
});

// =============================================================================
// checkWebsiteBlocklist
// =============================================================================
describe('checkWebsiteBlocklist', () => {
  it('returns undefined when blocklist is disabled', () => {
    const result = checkWebsiteBlocklist('https://evil.com', { enabled: false, domains: ['evil.com'] });
    expect(result).toBeUndefined();
  });

  it('returns undefined when blocklist is undefined', () => {
    expect(checkWebsiteBlocklist('https://evil.com', undefined)).toBeUndefined();
  });

  it('returns undefined when domains list is empty', () => {
    expect(checkWebsiteBlocklist('https://evil.com', { enabled: true, domains: [] })).toBeUndefined();
  });

  it('blocks exact domain match', () => {
    const result = checkWebsiteBlocklist('https://evil.com/page', {
      enabled: true,
      domains: ['evil.com'],
    });
    expect(result).toBeDefined();
    expect(result!.host).toBe('evil.com');
    expect(result!.rule).toBe('evil.com');
  });

  it('blocks subdomain of a blocked domain', () => {
    const result = checkWebsiteBlocklist('https://sub.evil.com/page', {
      enabled: true,
      domains: ['evil.com'],
    });
    expect(result).toBeDefined();
    expect(result!.host).toBe('sub.evil.com');
  });

  it('does not block unrelated domains', () => {
    const result = checkWebsiteBlocklist('https://good.com/page', {
      enabled: true,
      domains: ['evil.com'],
    });
    expect(result).toBeUndefined();
  });

  it('supports wildcard patterns (*.evil.org)', () => {
    const blocklist = { enabled: true, domains: ['*.evil.org'] };
    expect(checkWebsiteBlocklist('https://sub.evil.org/', blocklist)).toBeDefined();
    expect(checkWebsiteBlocklist('https://evil.org/', blocklist)).toBeDefined();
    expect(checkWebsiteBlocklist('https://good.org/', blocklist)).toBeUndefined();
  });

  it('normalizes domain patterns (strips protocol, www, trailing dots)', () => {
    const blocklist = { enabled: true, domains: ['https://www.evil.com/path'] };
    const result = checkWebsiteBlocklist('https://evil.com/', blocklist);
    expect(result).toBeDefined();
  });

  it('strips www. from the checked URL host', () => {
    const result = checkWebsiteBlocklist('https://www.evil.com/', {
      enabled: true,
      domains: ['evil.com'],
    });
    expect(result).toBeDefined();
  });

  it('ignores comment lines in domain list', () => {
    const result = checkWebsiteBlocklist('https://example.com/', {
      enabled: true,
      domains: ['# this is a comment', 'evil.com'],
    });
    expect(result).toBeUndefined();
  });
});

// =============================================================================
// cleanBase64Images
// =============================================================================
describe('cleanBase64Images', () => {
  it('removes markdown base64 images', () => {
    const input = '![alt](data:image/png;base64,iVBOR) some text';
    const result = cleanBase64Images(input);
    expect(result).toContain('some text');
    expect(result).toContain('[image removed]');
    expect(result).not.toContain('iVBOR');
  });

  it('removes parenthesized base64 images', () => {
    const input = 'before (data:image/jpeg;base64,/9j/4AAQ) after';
    const result = cleanBase64Images(input);
    expect(result).toContain('before');
    expect(result).toContain('after');
    expect(result).not.toContain('/9j/4AAQ');
  });

  it('removes bare base64 data URIs', () => {
    const input = 'src="data:image/svg+xml;base64,PHN2Zz4=" class="icon"';
    const result = cleanBase64Images(input);
    expect(result).not.toContain('PHN2Zz4');
  });

  it('preserves normal text without base64', () => {
    const input = 'Hello world, no images here!';
    expect(cleanBase64Images(input)).toBe(input);
  });
});
