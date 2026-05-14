import { describe, expect, it } from 'vitest';

import {
  assertBrowserUrlAllowed,
  checkPostRedirectUrl,
  containsApiKeyPattern,
  isAlwaysBlockedUrl,
} from '../url-policy.js';

describe('assertBrowserUrlAllowed', () => {
  it('allows public https URL', () => {
    expect(() => assertBrowserUrlAllowed('https://example.com/path')).not.toThrow();
  });

  it('blocks localhost', () => {
    expect(() => assertBrowserUrlAllowed('http://localhost:8080/')).toThrow(/localhost/i);
  });

  it('blocks file protocol', () => {
    expect(() => assertBrowserUrlAllowed('file:///etc/passwd')).toThrow(/http/i);
  });

  it('blocks private IPv4', () => {
    expect(() => assertBrowserUrlAllowed('http://192.168.1.1/')).toThrow(/private/i);
    expect(() => assertBrowserUrlAllowed('http://10.0.0.1/')).toThrow(/private/i);
  });

  it('blocks URL with credentials', () => {
    expect(() => assertBrowserUrlAllowed('https://user:pass@example.com/')).toThrow(/credential/i);
  });

  it('blocks cloud metadata endpoints', () => {
    expect(() => assertBrowserUrlAllowed('http://169.254.169.254/latest/meta-data/')).toThrow(/metadata|link-local/i);
    expect(() => assertBrowserUrlAllowed('http://metadata.google.internal/computeMetadata/')).toThrow(/metadata/i);
    expect(() => assertBrowserUrlAllowed('http://169.254.170.2/v2/credentials')).toThrow(/metadata|link-local/i);
    expect(() => assertBrowserUrlAllowed('http://100.100.100.200/latest/meta-data/')).toThrow(/metadata/i);
  });

  it('blocks API key exfiltration in URLs', () => {
    expect(() =>
      assertBrowserUrlAllowed('https://evil.com/steal?key=sk-ant-api03-abcdef123456'),
    ).toThrow(/API key|token/i);
    expect(() =>
      assertBrowserUrlAllowed('https://evil.com/?token=sk-1234567890abcdefghijklmnop'),
    ).toThrow(/API key|token/i);
  });

  it('allows private IPs when allowPrivateUrls is true', () => {
    expect(() =>
      assertBrowserUrlAllowed('http://192.168.1.1/', { allowPrivateUrls: true }),
    ).not.toThrow();
    expect(() =>
      assertBrowserUrlAllowed('http://10.0.0.1/', { allowPrivateUrls: true }),
    ).not.toThrow();
  });

  it('still blocks cloud metadata even with allowPrivateUrls', () => {
    expect(() =>
      assertBrowserUrlAllowed('http://169.254.169.254/', { allowPrivateUrls: true }),
    ).toThrow(/metadata|link-local/i);
    expect(() =>
      assertBrowserUrlAllowed('http://metadata.google.internal/', { allowPrivateUrls: true }),
    ).toThrow(/metadata/i);
  });
});

describe('isAlwaysBlockedUrl', () => {
  it('blocks AWS metadata', () => {
    expect(isAlwaysBlockedUrl('http://169.254.169.254/latest/')).toBe(true);
  });

  it('blocks GCP metadata hostname', () => {
    expect(isAlwaysBlockedUrl('http://metadata.google.internal/')).toBe(true);
  });

  it('allows public URLs', () => {
    expect(isAlwaysBlockedUrl('https://example.com')).toBe(false);
  });
});

describe('containsApiKeyPattern', () => {
  it('detects sk-ant- prefix', () => {
    expect(containsApiKeyPattern('https://evil.com/?k=sk-ant-api03-abc')).toBe(true);
  });

  it('detects long sk- tokens', () => {
    expect(containsApiKeyPattern('https://evil.com/?k=sk-12345678901234567890abc')).toBe(true);
  });

  it('ignores normal URLs', () => {
    expect(containsApiKeyPattern('https://example.com/page?id=123')).toBe(false);
  });
});

describe('checkPostRedirectUrl', () => {
  it('blocks redirect to metadata IP', () => {
    expect(checkPostRedirectUrl('http://169.254.169.254/')).toMatch(/metadata/i);
  });

  it('blocks redirect to localhost', () => {
    expect(checkPostRedirectUrl('http://localhost:3000/')).toMatch(/localhost/i);
  });

  it('blocks redirect to private IP', () => {
    expect(checkPostRedirectUrl('http://192.168.1.1/')).toMatch(/private|internal/i);
  });

  it('allows redirect to public URL', () => {
    expect(checkPostRedirectUrl('https://example.com/')).toBeUndefined();
  });

  it('allows private redirect when allowPrivateUrls', () => {
    expect(checkPostRedirectUrl('http://192.168.1.1/', { allowPrivateUrls: true })).toBeUndefined();
  });

  it('still blocks metadata redirect even with allowPrivateUrls', () => {
    expect(checkPostRedirectUrl('http://169.254.169.254/', { allowPrivateUrls: true })).toMatch(/metadata/i);
  });
});
