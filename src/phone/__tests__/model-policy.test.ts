import { describe, expect, it } from 'vitest';

import { validateModelsConfig } from '../../config/models-json.js';
import { EXTENSION_PROVIDER_BASE_URL } from '../../providers/constants.js';
import { isDedicatedPhoneModel, phoneModelProfile } from '../model-policy.js';

const visual = { api: 'openai-responses', input: ['text', 'image'], provider: 'openai', baseUrl: 'https://api.openai.com/v1' };

describe('phone model discovery', () => {
  it.each(['openai-completions', 'openai-responses'])('discovers ordinary visual tool models using %s', api => {
    expect(phoneModelProfile({ ...visual, api })).toBe('structured-tools-phone-v1');
    expect(isDedicatedPhoneModel({ ...visual, api })).toBe(false);
  });
  it.each([
    { input: ['text'] }, { api: 'anthropic-messages' }, { supportsTools: false },
    { provider: 'xopc-cloud' }, { baseUrl: EXTENSION_PROVIDER_BASE_URL },
    { phoneUse: { profile: 'unknown' } }, { computerUse: { profile: 'gui-plus-2026-02-26' } },
  ])('excludes incompatible or undeclared managed protocols (%j)', override => {
    expect(phoneModelProfile({ ...visual, ...override })).toBeUndefined();
  });
  it('keeps native profiles explicit and preserves their API constraints', () => {
    for (const profile of ['autoglm-phone-v1', 'structured-phone-v1', 'doubao-seed-phone-v1', 'gui-owl-phone-v1']) {
      const model = { ...visual, api: 'openai-completions', phoneUse: { profile } };
      expect(phoneModelProfile(model)).toBe(profile);
      expect(isDedicatedPhoneModel(model)).toBe(true);
      expect(phoneModelProfile({ ...model, api: 'openai-responses' })).toBeUndefined();
    }
  });
  it('validates explicit generic tools without accepting mismatched native Responses protocols', () => {
    const config = (profile: string, supportsTools = true) => ({ providers: { custom: {
      api: 'openai-responses', baseUrl: 'https://model.test/v1',
      models: [{ id: 'visual', input: ['text', 'image'], supportsTools, phoneUse: { profile } }],
    } } });
    expect(validateModelsConfig(config('structured-tools-phone-v1')).valid).toBe(true);
    expect(validateModelsConfig(config('structured-tools-phone-v1', false)).valid).toBe(false);
    expect(validateModelsConfig(config('autoglm-phone-v1')).valid).toBe(false);
  });
});
