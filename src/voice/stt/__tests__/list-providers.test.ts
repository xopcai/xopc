import { describe, expect, it } from 'vitest';

import { listSttProvidersForApi } from '../list-providers.js';
import '../providers/index.js';

describe('listSttProvidersForApi', () => {
  it('lists built-in audio providers with configured state', () => {
    const payload = listSttProvidersForApi({
      tools: {
        media: {
          audio: {
            enabled: true,
            provider: 'openai',
            providers: {
              openai: { apiKey: 'sk-test' },
            },
          },
        },
      },
    } as never);

    expect(payload.active).toBe('openai');
    expect(payload.providers.some((p) => p.id === 'openai' && p.configured)).toBe(true);
    expect(payload.providers.some((p) => p.id === 'alibaba')).toBe(true);
  });
});
