import { describe, expect, it } from 'vitest';

import {
  PROVIDER_PRESET_OPTIONS,
  PROVIDER_PRESETS,
  buildProviderConfigFromPresetProviderId,
  modelsJsonPresetKeyForProviderId,
  providerIdForPreset,
  providerPresetKeyForProviderId,
} from '@/features/settings/models/models-settings-lib';

describe('models settings provider presets', () => {
  it('exposes domestic provider presets for the add-provider dialog', () => {
    expect(PROVIDER_PRESET_OPTIONS.map((option) => option.providerId)).toEqual(
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
  });

  it('preserves preset model metadata when constructing defaults', () => {
    expect(providerIdForPreset('zhipuCn')).toBe('zhipu-cn');
    expect(providerPresetKeyForProviderId('dashscope-cn')).toBe('dashscopeCn');
    expect(modelsJsonPresetKeyForProviderId('dashscope-cn')).toBe('dashscopeCn');
    expect(modelsJsonPresetKeyForProviderId('openrouter')).toBeUndefined();
    expect(PROVIDER_PRESETS.minimax.config).toMatchObject({
      baseUrl: 'https://api.minimax.io/anthropic',
      api: 'anthropic-messages',
      authHeader: true,
    });
    expect(PROVIDER_PRESETS.dashscopeCn.config).toMatchObject({
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      api: 'openai-completions',
    });
    expect(PROVIDER_PRESETS.dashscopeIntl.config).toMatchObject({
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      api: 'openai-completions',
    });
    expect(PROVIDER_PRESETS.dashscopeCn.config.models?.[0]).toMatchObject({
      id: 'qwen3.7-max',
      contextWindow: 1000000,
    });
    expect(PROVIDER_PRESETS.zhipuCodingCn.config).toMatchObject({
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      api: 'openai-completions',
    });
  });

  it('builds models.json provider config for onboarding preset-only providers', () => {
    expect(buildProviderConfigFromPresetProviderId('openrouter', 'sk-or')).toBeUndefined();

    const entry = buildProviderConfigFromPresetProviderId('dashscope-cn', 'sk-dashscope');
    expect(entry).toMatchObject({
      providerId: 'dashscope-cn',
      config: {
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        api: 'openai-completions',
        apiKey: 'sk-dashscope',
      },
    });
    expect(entry?.config.models?.map((model) => model.id)).toContain('qwen3.7-plus');
  });
});
