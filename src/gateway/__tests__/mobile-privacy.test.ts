import { describe, expect, it, vi } from 'vitest';

vi.mock('../../providers/index.js', () => ({
  getAvailableModels: async () => [
    { provider: 'custom', baseUrl: 'https://user:secret@models.example/v1?key=private' },
    { provider: 'custom', baseUrl: 'https://models.example/v2' },
  ],
  PROVIDER_META: { custom: { name: 'Custom model service' } },
}));
vi.mock('../../providers/plugin-registry.js', () => ({ getProviderRegistry: () => ({ get: () => undefined }) }));
vi.mock('../../voice/metadata/index.js', () => ({ getVoiceProviderMetadata: () => undefined }));
vi.mock('../../voice/stt/config.js', () => ({ mergeSttConfigFromAppConfig: () => ({}) }));
vi.mock('../../voice/stt/factory.js', () => ({
  resolveSTTProviderChain: () => [
    { id: 'primary-stt', apiKey: 'secret', baseUrl: 'https://stt.example/v1' },
    { id: 'fallback-stt', apiKey: 'secret', baseUrl: 'https://fallback.example/v1' },
  ],
}));
vi.mock('../../voice/tts/merge-config.js', () => ({ mergeTtsConfigFromAppConfig: () => ({ enabled: true }) }));
vi.mock('../../voice/tts/factory.js', () => ({
  resolveSpeechProviderChain: () => [{ providerId: 'speech', providerConfig: { apiKey: 'secret', baseUrl: 'https://speech.example/v1' } }],
}));
vi.mock('../image-generation-setup.js', () => ({ getImageGenerationCatalog: () => [] }));

import type { Config } from '../../config/schema.js';
import { buildMobilePrivacyDisclosure, getMobilePrivacyDisclosure, privacyRecipientOrigin } from '../mobile-privacy.js';
import { requiredGatewayScope } from '../security/gateway-scopes.js';

describe('mobile privacy disclosure', () => {
  it('reports configured model and speech fallbacks without credentials or URL paths', async () => {
    const disclosure = await getMobilePrivacyDisclosure({} as Config);
    expect(disclosure.recipients.filter((entry) => entry.id === 'custom')).toHaveLength(1);
    expect(disclosure.recipients).toContainEqual({ id: 'fallback-stt', name: 'fallback-stt', capability: 'transcription', origin: 'https://fallback.example' });
    expect(JSON.stringify(disclosure)).not.toMatch(/secret|private|apiKey|\/v1|user:/);
  });

  it('keeps revisions stable across ordering and changes them for new recipient origins', () => {
    const one = { id: 'a', name: 'A', capability: 'model' as const, origin: 'https://a.example' };
    const two = { id: 'b', name: 'B', capability: 'speech' as const };
    expect(buildMobilePrivacyDisclosure([one, two]).revision).toBe(buildMobilePrivacyDisclosure([two, one, one]).revision);
    expect(buildMobilePrivacyDisclosure([one]).revision).not.toBe(buildMobilePrivacyDisclosure([{ ...one, origin: 'https://proxy.example' }]).revision);
  });

  it('omits non-HTTP endpoints and strips URL credentials', () => {
    expect(privacyRecipientOrigin('file:///private/key')).toBeUndefined();
    expect(privacyRecipientOrigin('https://user:password@proxy.example:8443/private?token=key')).toBe('https://proxy.example:8443');
  });

  it('permits disclosure reads with mobile status scope without granting config administration', () => {
    expect(requiredGatewayScope('GET', '/api/mobile/privacy')).toBe('gateway.status');
    expect(requiredGatewayScope('POST', '/api/mobile/privacy')).toBe('gateway.admin');
    expect(requiredGatewayScope('GET', '/api/config')).toBe('gateway.admin');
  });
});
