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

    expect(ids).toEqual(
      expect.arrayContaining([
        'dashscope-cn',
        'dashscope-intl',
        'volcengine-ark',
        'volcengine-plan',
        'byteplus-plan',
        'deepseek',
        'moonshotai',
        'moonshotai-cn',
        'kimi-coding',
        'stepfun-cn',
        'stepfun-intl',
        'stepfun-plan-cn',
        'stepfun-plan-intl',
        'xiaomi',
        'xiaomi-token-plan-cn',
        'xiaomi-token-plan-ams',
        'xiaomi-token-plan-sgp',
        'zhipu-cn',
        'zai',
        'zai-coding-global',
        'zhipu-coding-cn',
        'minimax',
        'minimax-cn',
      ]),
    );

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

  it('preserves provider-specific compatibility choices', () => {
    const minimax = getDomesticProviderPreset('minimax');
    const ark = getDomesticProviderPreset('volcengine-ark');

    expect(minimax).toBeDefined();
    expect(providerConfigFromDomesticPreset(minimax!, { apiKey: 'MINIMAX_API_KEY' })).toMatchObject({
      baseUrl: 'https://api.minimax.io/anthropic',
      api: 'anthropic-messages',
      authHeader: true,
    });

    expect(ark?.defaultModel).toBe('ep-your-endpoint-id');
  });

  it('feeds onboarding and provider presentation before a provider is configured', () => {
    const featuredProviders = getOnboardingFeaturedProviders();

    expect(featuredProviders[0]).toBe('deepseek');
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
        'zhipu-coding-cn',
      ]),
    );
    expect(getRecommendedModelsForProvider('dashscope-cn').map((model) => model.ref)).toContain(
      'dashscope-cn/qwen3.7-plus',
    );
    expect(getRecommendedModelsForProvider('ant-ling').map((model) => model.ref)).toContain('ant-ling/Ling-2.6-1T');
    expect(getRecommendedModelsForProvider('zai-coding-cn').map((model) => model.ref)).toContain(
      'zai-coding-cn/glm-5.2',
    );
    expect(getRecommendedModelsForProvider('zhipu-coding-cn').map((model) => model.ref)).toContain(
      'zhipu-coding-cn/glm-5.2',
    );
  });
});
