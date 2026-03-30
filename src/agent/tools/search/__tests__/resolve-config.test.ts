import { describe, it, expect } from 'vitest';
import { resolveWebSearchConfig } from '../resolve-config.js';

describe('resolveWebSearchConfig', () => {
  it('resolves providers from config', () => {
    const r = resolveWebSearchConfig({
      region: 'cn',
      search: {
        maxResults: 10,
        providers: [{ type: 'tavily', apiKey: 'tvly-x' }],
      },
    });
    expect(r.region).toBe('cn');
    expect(r.maxResults).toBe(10);
    expect(r.providers[0]).toEqual(
      expect.objectContaining({ type: 'tavily', apiKey: 'tvly-x' }),
    );
  });

  it('defaults to empty providers', () => {
    const r = resolveWebSearchConfig({
      search: { maxResults: 5, providers: [] },
    });
    expect(r.providers).toEqual([]);
  });
});
