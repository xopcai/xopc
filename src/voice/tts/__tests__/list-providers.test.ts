import { describe, expect, it } from 'vitest';

import { listTtsProvidersForApi } from '../list-providers.js';
import '../factory.js';

describe('listTtsProvidersForApi', () => {
  it('lists built-in providers with configured state', () => {
    const payload = listTtsProvidersForApi({
      messages: {
        tts: {
          enabled: true,
          provider: 'edge',
          edge: { enabled: true },
          fallback: { enabled: false, order: [] },
        },
      },
    } as never);

    expect(payload.active).toBe('edge');
    expect(payload.providers.some((p) => p.id === 'openai')).toBe(true);
    expect(payload.providers.some((p) => p.id === 'edge' && p.configured)).toBe(true);
  });
});
