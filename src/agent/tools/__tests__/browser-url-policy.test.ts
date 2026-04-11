import { describe, expect, it } from 'vitest';

import { assertBrowserUrlAllowed } from '../browser/url-policy.js';

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
});
