import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveWebSearchConfig } from '../resolve-config.js';

describe('resolveWebSearchConfig', () => {
  const prevBrave = process.env.BRAVE_API_KEY;

  beforeEach(() => {
    delete process.env.BRAVE_API_KEY;
  });

  afterEach(() => {
    if (prevBrave !== undefined) process.env.BRAVE_API_KEY = prevBrave;
    else delete process.env.BRAVE_API_KEY;
  });

  it('uses legacy Brave apiKey from config', () => {
    const r = resolveWebSearchConfig({
      search: { apiKey: 'BSA_test', maxResults: 5 },
    });
    expect(r.apiKey).toBe('BSA_test');
    expect(r.providers).toBeUndefined();
  });

  it('falls back to BRAVE_API_KEY when search apiKey empty', () => {
    process.env.BRAVE_API_KEY = 'from-env';
    const r = resolveWebSearchConfig({
      search: { apiKey: '', maxResults: 5 },
    });
    expect(r.apiKey).toBe('from-env');
  });

  it('parses explicit providers', () => {
    const r = resolveWebSearchConfig({
      region: 'cn',
      search: {
        apiKey: '',
        maxResults: 10,
        providers: [{ type: 'tavily', apiKey: 'tvly-x' }],
      },
    });
    expect(r.region).toBe('cn');
    expect(r.providers?.[0]).toEqual(
      expect.objectContaining({ type: 'tavily', apiKey: 'tvly-x' }),
    );
  });
});
