import { getProviders as getPiProviders } from '@earendil-works/pi-ai/compat';
import { describe, expect, it } from 'vitest';

import { validateModelsConfig, type ModelsJsonConfig } from '../../config/models-json.js';
import {
  DOMESTIC_PROVIDER_PRESETS,
  getDomesticProviderPreset,
  providerConfigFromDomesticPreset,
} from '../domestic-presets.js';
import { getRecommendedModelsForProvider, getOnboardingFeaturedProviders } from '../presentation.js';

describe('domestic provider presets', () => {
  it('cover the supported domestic providers with valid models.json configs', () => {
    const ids = DOMESTIC_PROVIDER_PRESETS.map((preset) => preset.id);

    expect(ids).toEqual(expect.arrayContaining([
      'dashscope-cn', 'dashscope-intl', 'volcengine-ark', 'volcengine-plan', 'byteplus-plan',
      'stepfun-cn', 'stepfun-intl', 'stepfun-plan-cn', 'stepfun-plan-intl', 'zhipu-cn', 'zai-api',
    ]));
    for (const provider of getPiProviders()) expect(ids).not.toContain(provider);
    expect(ids).not.toContain('zai-coding-global');
    expect(ids).not.toContain('zhipu-coding-cn');

    const config: ModelsJsonConfig = {
      providers: Object.fromEntries(
        DOMESTIC_PROVIDER_PRESETS.map((preset) => [
          preset.id,
          providerConfigFromDomesticPreset(preset, { apiKey: preset.envVars[0] }),
        ]),
      ),
    };

    expect(validateModelsConfig(config)).toEqual({ valid: true, errors: [] });
  });

  it('preserves provider-specific endpoint choices', () => {
    const zai = getDomesticProviderPreset('zai-api');
    const ark = getDomesticProviderPreset('volcengine-ark');

    expect(getDomesticProviderPreset('minimax')).toBeUndefined();
    expect(getDomesticProviderPreset('xopc-cloud')).toBeUndefined();
    expect(providerConfigFromDomesticPreset(zai!, { apiKey: 'ZAI_API_KEY' })).toMatchObject({
      baseUrl: 'https://api.z.ai/api/paas/v4', api: 'openai-completions',
    });

    expect(ark?.defaultModel).toBe('ep-your-endpoint-id');
  });

  it('rejects configuring the OAuth-managed XOPC provider in models.json', () => {
    expect(validateModelsConfig({
      providers: {
        'xopc-cloud': {
          baseUrl: 'https://router.xopc.ai/v1',
          api: 'openai-completions',
          apiKey: 'old-static-key',
          models: [{ id: 'old-model' }],
        },
      },
    })).toMatchObject({ valid: false });
  });

  it('feeds onboarding and provider presentation before a provider is configured', () => {
    const featuredProviders = getOnboardingFeaturedProviders();

    expect(featuredProviders[0]).toBe('xopc-cloud');
    expect(featuredProviders).toEqual(
      expect.arrayContaining([
        'dashscope-cn',
        'dashscope-intl',
        'volcengine-ark',
        'volcengine-plan',
        'stepfun-cn',
        'stepfun-plan-cn',
        'ant-ling',
        'zai-coding-cn',
      ]),
    );
    expect(getRecommendedModelsForProvider('dashscope-cn').map((model) => model.ref)).toContain(
      'dashscope-cn/qwen3.7-plus',
    );
    expect(getRecommendedModelsForProvider('ant-ling').map((model) => model.ref)).toContain('ant-ling/Ling-2.6-1T');
    expect(getRecommendedModelsForProvider('zai-coding-cn').map((model) => model.ref)).toContain(
      'zai-coding-cn/glm-5.3',
    );
  });
});
