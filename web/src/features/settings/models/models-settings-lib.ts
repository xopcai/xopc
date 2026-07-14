import { selectFieldMaxWidthClass, selectTriggerClass, settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';

import type { CustomModel, ModelsJsonConfig, ProviderConfig } from '../models-json-api';

export interface ProviderPresetOption {
  label: string;
  providerId: string;
  description?: string;
  config: Partial<ProviderConfig>;
}

export const PROVIDER_PRESETS: Record<string, ProviderPresetOption> = {
  ollama: {
    label: 'Ollama',
    providerId: 'ollama',
    config: {
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKey: 'ollama',
    },
  },
  lmstudio: {
    label: 'LM Studio',
    providerId: 'lmstudio',
    config: {
      baseUrl: 'http://localhost:1234/v1',
      api: 'openai-completions',
      apiKey: 'lmstudio',
    },
  },
  openrouter: {
    label: 'OpenRouter',
    providerId: 'openrouter',
    config: {
      baseUrl: 'https://openrouter.ai/api/v1',
      api: 'openai-completions',
      apiKey: '',
    },
  },
  zhipuCn: {
    label: 'Zhipu GLM China',
    providerId: 'zhipu-cn',
    config: {
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      api: 'openai-completions',
      apiKey: 'ZHIPU_API_KEY',
      models: [
        { id: 'glm-5.2', name: 'GLM 5.2', contextWindow: 1000000, maxTokens: 65536, reasoning: true, input: ['text'] },
      ],
    },
  },
  zaiGeneral: {
    label: 'Zhipu GLM International',
    providerId: 'zai',
    config: {
      baseUrl: 'https://api.z.ai/api/paas/v4',
      api: 'openai-completions',
      apiKey: 'ZAI_API_KEY',
      models: [
        { id: 'glm-5.2', name: 'GLM 5.2', contextWindow: 1000000, maxTokens: 65536, reasoning: true, input: ['text'] },
      ],
    },
  },
  dashscopeCn: {
    label: 'Alibaba Bailian / DashScope China',
    providerId: 'dashscope-cn',
    description: 'China OpenAI-compatible Qwen endpoint',
    config: {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      api: 'openai-completions',
      apiKey: 'DASHSCOPE_API_KEY',
      models: [
        { id: 'qwen3.7-max', name: 'Qwen3.7 Max', contextWindow: 1000000, input: ['text', 'image'] },
        { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', contextWindow: 1000000, input: ['text', 'image'] },
        { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash', contextWindow: 1000000, input: ['text'] },
      ],
    },
  },
  dashscopeIntl: {
    label: 'Alibaba Bailian / DashScope International',
    providerId: 'dashscope-intl',
    description: 'International OpenAI-compatible Qwen endpoint',
    config: {
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      api: 'openai-completions',
      apiKey: 'DASHSCOPE_API_KEY',
      models: [
        { id: 'qwen3.7-max', name: 'Qwen3.7 Max', contextWindow: 1000000, input: ['text', 'image'] },
        { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', contextWindow: 1000000, input: ['text', 'image'] },
        { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash', contextWindow: 1000000, input: ['text'] },
      ],
    },
  },
  volcengineArk: {
    label: 'Volcengine Ark',
    providerId: 'volcengine-ark',
    description: 'Use your Ark endpoint id as the model id',
    config: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      api: 'openai-completions',
      apiKey: 'ARK_API_KEY',
      models: [{ id: 'ep-your-endpoint-id', name: 'Ark endpoint ID', contextWindow: 128000, input: ['text'] }],
    },
  },
  volcenginePlan: {
    label: 'Volcengine Doubao Coding Plan',
    providerId: 'volcengine-plan',
    description: 'Doubao coding-plan endpoint on Volcengine Ark',
    config: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      api: 'openai-completions',
      apiKey: 'ARK_API_KEY',
      models: [
        { id: 'ark-code-latest', name: 'Ark Coding Plan', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
        { id: 'doubao-seed-2.0-code', name: 'Doubao Seed 2.0 Code', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
        { id: 'doubao-seed-2.0-pro', name: 'Doubao Seed 2.0 Pro', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
        { id: 'doubao-seed-2.0-lite', name: 'Doubao Seed 2.0 Lite', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
      ],
    },
  },
  byteplusPlan: {
    label: 'BytePlus Doubao Coding Plan',
    providerId: 'byteplus-plan',
    description: 'Doubao coding-plan endpoint on BytePlus',
    config: {
      baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
      api: 'openai-completions',
      apiKey: 'BYTEPLUS_API_KEY',
      models: [
        { id: 'ark-code-latest', name: 'Ark Coding Plan', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
        { id: 'doubao-seed-2.0-code', name: 'Doubao Seed 2.0 Code', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
        { id: 'doubao-seed-2.0-pro', name: 'Doubao Seed 2.0 Pro', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
        { id: 'doubao-seed-2.0-lite', name: 'Doubao Seed 2.0 Lite', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
      ],
    },
  },
  deepseek: {
    label: 'DeepSeek',
    providerId: 'deepseek',
    config: {
      baseUrl: 'https://api.deepseek.com',
      api: 'openai-completions',
      apiKey: 'DEEPSEEK_API_KEY',
      models: [
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 1000000, maxTokens: 393216, reasoning: true, input: ['text'] },
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 1000000, maxTokens: 393216, reasoning: true, input: ['text'] },
      ],
    },
  },
  moonshotCn: {
    label: 'Kimi / Moonshot China',
    providerId: 'moonshotai-cn',
    config: {
      baseUrl: 'https://api.moonshot.cn/v1',
      api: 'openai-completions',
      apiKey: 'MOONSHOT_API_KEY',
      models: [
        { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: 262144, maxTokens: 32768, reasoning: true, input: ['text', 'image'] },
        { id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: 128000, input: ['text'] },
      ],
    },
  },
  moonshotIntl: {
    label: 'Kimi / Moonshot International',
    providerId: 'moonshotai',
    config: {
      baseUrl: 'https://api.moonshot.ai/v1',
      api: 'openai-completions',
      apiKey: 'MOONSHOT_API_KEY',
      models: [
        { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: 262144, maxTokens: 32768, reasoning: true, input: ['text', 'image'] },
        { id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: 128000, input: ['text'] },
      ],
    },
  },
  kimiCoding: {
    label: 'Kimi Coding',
    providerId: 'kimi-coding',
    description: 'Dedicated Kimi coding endpoint',
    config: {
      baseUrl: 'https://api.kimi.com/coding',
      api: 'anthropic-messages',
      apiKey: 'KIMI_API_KEY',
      headers: { 'User-Agent': 'KimiCLI/1.5' },
      models: [
        { id: 'k2p7', name: 'Kimi K2.7 Code', contextWindow: 262144, maxTokens: 32768, reasoning: true, input: ['text', 'image'] },
        { id: 'kimi-for-coding', name: 'Kimi For Coding', contextWindow: 262144, maxTokens: 32768, reasoning: true, input: ['text', 'image'] },
      ],
    },
  },
  stepfunIntl: {
    label: 'StepFun International',
    providerId: 'stepfun-intl',
    config: {
      baseUrl: 'https://api.stepfun.ai/v1',
      api: 'openai-completions',
      apiKey: 'STEPFUN_API_KEY',
      models: [
        { id: 'step-3.7-flash', name: 'Step 3.7 Flash', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
        { id: 'step-3.5-flash-2603', name: 'Step 3.5 Flash 2603', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
        { id: 'step-3.5-flash', name: 'Step 3.5 Flash', contextWindow: 1000000, reasoning: true, input: ['text'] },
      ],
    },
  },
  stepfunCn: {
    label: 'StepFun China',
    providerId: 'stepfun-cn',
    config: {
      baseUrl: 'https://api.stepfun.com/v1',
      api: 'openai-completions',
      apiKey: 'STEPFUN_API_KEY',
      models: [
        { id: 'step-3.7-flash', name: 'Step 3.7 Flash', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
        { id: 'step-3.5-flash-2603', name: 'Step 3.5 Flash 2603', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
        { id: 'step-3.5-flash', name: 'Step 3.5 Flash', contextWindow: 1000000, reasoning: true, input: ['text'] },
      ],
    },
  },
  stepfunPlanIntl: {
    label: 'StepFun Step Plan International',
    providerId: 'stepfun-plan-intl',
    config: {
      baseUrl: 'https://api.stepfun.ai/step_plan/v1',
      api: 'openai-completions',
      apiKey: 'STEPFUN_API_KEY',
      models: [
        { id: 'step-3.7-flash', name: 'Step 3.7 Flash', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
        { id: 'step-3.5-flash-2603', name: 'Step 3.5 Flash 2603', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
        { id: 'step-3.5-flash', name: 'Step 3.5 Flash', contextWindow: 1000000, reasoning: true, input: ['text'] },
      ],
    },
  },
  stepfunPlanCn: {
    label: 'StepFun Step Plan China',
    providerId: 'stepfun-plan-cn',
    config: {
      baseUrl: 'https://api.stepfun.com/step_plan/v1',
      api: 'openai-completions',
      apiKey: 'STEPFUN_API_KEY',
      models: [
        { id: 'step-3.7-flash', name: 'Step 3.7 Flash', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
        { id: 'step-3.5-flash-2603', name: 'Step 3.5 Flash 2603', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
        { id: 'step-3.5-flash', name: 'Step 3.5 Flash', contextWindow: 1000000, reasoning: true, input: ['text'] },
      ],
    },
  },
  xiaomi: {
    label: 'Xiaomi MiMo',
    providerId: 'xiaomi',
    config: {
      baseUrl: 'https://api.xiaomimimo.com/v1',
      api: 'openai-completions',
      apiKey: 'XIAOMI_API_KEY',
      models: [
        { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', contextWindow: 1000000, reasoning: true, input: ['text'] },
        { id: 'mimo-v2.5-pro-ultraspeed', name: 'MiMo V2.5 Pro UltraSpeed', contextWindow: 1000000, reasoning: true, input: ['text'] },
        { id: 'mimo-v2.5', name: 'MiMo V2.5', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
      ],
    },
  },
  xiaomiTokenPlanCn: {
    label: 'Xiaomi MiMo Token Plan China',
    providerId: 'xiaomi-token-plan-cn',
    config: {
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      api: 'openai-completions',
      apiKey: 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
      models: [
        { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', contextWindow: 1000000, reasoning: true, input: ['text'] },
        { id: 'mimo-v2.5-pro-ultraspeed', name: 'MiMo V2.5 Pro UltraSpeed', contextWindow: 1000000, reasoning: true, input: ['text'] },
        { id: 'mimo-v2.5', name: 'MiMo V2.5', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
      ],
    },
  },
  xiaomiTokenPlanAms: {
    label: 'Xiaomi MiMo Token Plan Amsterdam',
    providerId: 'xiaomi-token-plan-ams',
    config: {
      baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
      api: 'openai-completions',
      apiKey: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
      models: [
        { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', contextWindow: 1000000, reasoning: true, input: ['text'] },
        { id: 'mimo-v2.5-pro-ultraspeed', name: 'MiMo V2.5 Pro UltraSpeed', contextWindow: 1000000, reasoning: true, input: ['text'] },
        { id: 'mimo-v2.5', name: 'MiMo V2.5', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
      ],
    },
  },
  xiaomiTokenPlanSgp: {
    label: 'Xiaomi MiMo Token Plan Singapore',
    providerId: 'xiaomi-token-plan-sgp',
    config: {
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
      api: 'openai-completions',
      apiKey: 'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
      models: [
        { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', contextWindow: 1000000, reasoning: true, input: ['text'] },
        { id: 'mimo-v2.5-pro-ultraspeed', name: 'MiMo V2.5 Pro UltraSpeed', contextWindow: 1000000, reasoning: true, input: ['text'] },
        { id: 'mimo-v2.5', name: 'MiMo V2.5', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
      ],
    },
  },
  minimax: {
    label: 'MiniMax',
    providerId: 'minimax',
    description: 'Anthropic-compatible endpoint preferred for agent workflows',
    config: {
      baseUrl: 'https://api.minimax.io/anthropic',
      api: 'anthropic-messages',
      apiKey: 'MINIMAX_API_KEY',
      authHeader: true,
      models: [
        { id: 'MiniMax-M3', name: 'MiniMax M3', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
        { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 Highspeed', contextWindow: 204800, input: ['text'] },
        { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', contextWindow: 204800, input: ['text'] },
      ],
    },
  },
  zhipuCodingCn: {
    label: 'Zhipu GLM Coding Plan China',
    providerId: 'zhipu-coding-cn',
    config: {
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      api: 'openai-completions',
      apiKey: 'ZHIPU_API_KEY',
      models: [
        { id: 'glm-5.2', name: 'GLM 5.2', contextWindow: 1000000, maxTokens: 65536, reasoning: true, input: ['text'] },
      ],
    },
  },
  zaiCodingGlobal: {
    label: 'Zhipu GLM Coding Plan International',
    providerId: 'zai-coding-global',
    config: {
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      api: 'openai-completions',
      apiKey: 'ZAI_API_KEY',
      models: [
        { id: 'glm-5.2', name: 'GLM 5.2', contextWindow: 1000000, maxTokens: 65536, reasoning: true, input: ['text'] },
      ],
    },
  },
  minimaxCn: {
    label: 'MiniMax China',
    providerId: 'minimax-cn',
    config: {
      baseUrl: 'https://api.minimaxi.com/anthropic',
      api: 'anthropic-messages',
      apiKey: 'MINIMAX_CN_API_KEY',
      authHeader: true,
      models: [
        { id: 'MiniMax-M3', name: 'MiniMax M3', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
        { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 Highspeed', contextWindow: 204800, input: ['text'] },
        { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', contextWindow: 204800, input: ['text'] },
      ],
    },
  },
};

export const PROVIDER_PRESET_OPTIONS = Object.entries(PROVIDER_PRESETS).map(([key, preset]) => ({
  key,
  ...preset,
}));

export function providerIdForPreset(presetKey: string): string {
  return PROVIDER_PRESETS[presetKey]?.providerId ?? presetKey;
}

export function providerPresetKeyForProviderId(providerId: string): string | undefined {
  return PROVIDER_PRESET_OPTIONS.find((option) => option.providerId === providerId)?.key;
}

const MODELS_JSON_PROVIDER_PRESET_IDS = new Set([
  'dashscope-cn',
  'dashscope-intl',
  'volcengine-ark',
  'volcengine-plan',
  'byteplus-plan',
  'stepfun-cn',
  'stepfun-intl',
  'stepfun-plan-cn',
  'stepfun-plan-intl',
  'zhipu-cn',
  'zai-coding-global',
  'zhipu-coding-cn',
]);

export function modelsJsonPresetKeyForProviderId(providerId: string): string | undefined {
  if (!MODELS_JSON_PROVIDER_PRESET_IDS.has(providerId)) return undefined;
  return providerPresetKeyForProviderId(providerId);
}

export function buildProviderConfigFromPresetProviderId(
  providerId: string,
  apiKey?: string,
): { providerId: string; config: ProviderConfig } | undefined {
  const presetKey = modelsJsonPresetKeyForProviderId(providerId);
  if (!presetKey) return undefined;
  const preset = PROVIDER_PRESETS[presetKey];
  if (!preset) return undefined;
  return {
    providerId: preset.providerId,
    config: {
      ...preset.config,
      apiKey: apiKey?.trim() || preset.config.apiKey,
      models: preset.config.models?.map((model) => ({ ...model })),
    },
  };
}

export const INPUT_OPTIONS = [
  { value: 'text', labelKey: 'inputTextOnly' as const },
  { value: 'text,image', labelKey: 'inputTextVision' as const },
];

export function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

export function selectClassName(): string {
  return cn(selectTriggerClass, selectFieldMaxWidthClass);
}

export function parseInputSelect(model: CustomModel): string {
  const i = model.input || ['text'];
  if (i.includes('image')) return 'text,image';
  return 'text';
}

export function inputFromSelect(sel: string): ('text' | 'image')[] {
  if (sel === 'text,image') return ['text', 'image'];
  return ['text'];
}

export function updateProvider(
  config: ModelsJsonConfig,
  providerId: string,
  updates: Partial<ProviderConfig>,
): ModelsJsonConfig {
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: {
        ...config.providers[providerId],
        ...updates,
      },
    },
  };
}

export function removeProvider(config: ModelsJsonConfig, providerId: string): ModelsJsonConfig {
  const providers = { ...config.providers };
  delete providers[providerId];
  return { ...config, providers };
}

export function addProviderEntry(
  config: ModelsJsonConfig,
  providerId: string,
  prov: ProviderConfig,
): ModelsJsonConfig {
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: prov,
    },
  };
}
