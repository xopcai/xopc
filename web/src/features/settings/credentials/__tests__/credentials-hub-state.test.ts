import { describe, expect, it } from 'vitest';

import { buildCredentialsHubSnapshot } from '@/features/settings/credentials/credentials-hub-state';

const labels = {
  llmMetaReady: (c: number, t: number) => `${c}/${t} llm`,
  llmConfigured: (c: number) => `${c} llm`,
  llmMissing: 'no llm',
  webSearchDisabled: 'search off',
  webSearchReady: (c: number, t: number) => `${c}/${t} search`,
  webSearchNoProviders: 'no search',
  imageReady: (c: number, t: number) => `${c}/${t} image`,
  imageNoProviders: 'no image',
  voiceDisabled: 'voice off',
  voiceReadyNoKeys: 'voice ok',
  voiceKeysReady: (c: number, t: number) => `${c}/${t} voice`,
  voiceMissing: 'no voice',
};

describe('buildCredentialsHubSnapshot', () => {
  it('marks LLM ready when at least one provider is configured', () => {
    const domains = buildCredentialsHubSnapshot({
      providerMeta: [
        { id: 'openai', name: 'OpenAI', category: 'common', supportsOAuth: false, supportsApiKey: true, configured: true },
        { id: 'anthropic', name: 'Anthropic', category: 'common', supportsOAuth: false, supportsApiKey: true, configured: false },
      ],
      webSearch: {
        regionMode: 'auto',
        maxResults: 5,
        providers: [],
        blocklistEnabled: false,
        blocklistDomains: [],
      },
      imageProviders: [],
      voice: null,
      labels,
    });

    expect(domains.find((d) => d.id === 'llm')?.status).toBe('ready');
    expect(domains.find((d) => d.id === 'webSearch')?.status).toBe('notNeeded');
  });

  it('reports partial web search when only some keys are set', () => {
    const domains = buildCredentialsHubSnapshot({
      providerMeta: [],
      webSearch: {
        regionMode: 'auto',
        maxResults: 5,
        providers: [
          { type: 'brave', apiKey: '***', url: '', disabled: false },
          { type: 'tavily', apiKey: '', url: '', disabled: false },
        ],
        blocklistEnabled: false,
        blocklistDomains: [],
      },
      imageProviders: [],
      voice: {
        stt: { enabled: false, provider: 'openai' },
        tts: { enabled: false, provider: 'edge', trigger: 'off' },
        voice: { languageMode: 'auto', language: 'en', input: { refinement: { mode: 'off' } } },
      },
      labels,
    });

    expect(domains.find((d) => d.id === 'webSearch')?.status).toBe('partial');
    expect(domains.find((d) => d.id === 'voice')?.status).toBe('notNeeded');
  });
});
