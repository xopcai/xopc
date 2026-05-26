import { describe, expect, it } from 'vitest';

import { resolveProviderOrder } from '../factory.js';
import '../providers/index.js';
import type { TTSConfig } from '../types.js';

describe('resolveProviderOrder', () => {
  it('uses explicit fallback order when enabled', () => {
    const order = resolveProviderOrder(
      'openai',
      { enabled: true, order: ['minimax', 'edge'] },
      {
        enabled: true,
        provider: 'openai',
        openai: { apiKey: 'sk-test' },
      } as TTSConfig,
    );
    expect(order).toEqual(['openai', 'minimax', 'edge']);
  });

  it('auto-selects configured providers by autoSelectOrder when fallback disabled', () => {
    const order = resolveProviderOrder(
      'edge',
      { enabled: false, order: [] },
      {
        enabled: true,
        provider: 'edge',
        openai: { apiKey: 'sk-test' },
        edge: { enabled: true },
      } as TTSConfig,
    );
    expect(order[0]).toBe('edge');
    expect(order).toContain('openai');
    if (order.includes('alibaba')) {
      expect(order.indexOf('openai')).toBeLessThan(order.indexOf('alibaba'));
    }
  });
});
