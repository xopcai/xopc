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
    label: 'Zhipu GLM API (International)',
    providerId: 'zai-api',
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
  dashscopePhone: {
    label: 'Alibaba Bailian · Phone Use',
    providerId: 'dashscope-phone',
    description: 'Beijing GUI-Plus API, the official GUI-Owl hosted entry; requires a Beijing Bailian key',
    config: {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      api: 'openai-completions',
      apiKey: 'DASHSCOPE_API_KEY',
      models: [
        { id: 'gui-plus-2026-02-26', name: 'Bailian GUI-Plus · Phone', input: ['text', 'image'], contextWindow: 262144, maxTokens: 4096, phoneUse: { profile: 'gui-owl-phone-v1' } },
      ],
    },
  },
  modelscope: {
    label: 'ModelScope',
    providerId: 'modelscope',
    description: 'General inference; select a model currently offered by ModelScope',
    config: {
      baseUrl: 'https://api-inference.modelscope.cn/v1',
      api: 'openai-completions',
      apiKey: 'MODELSCOPE_TOKEN',
      models: [
        { id: 'Qwen/Qwen3.5-35B-A3B', name: 'Qwen3.5 35B A3B', input: ['text'], maxTokens: 4096 },
      ],
    },
  },
  volcengineArk: {
    label: 'Volcengine Ark',
    providerId: 'volcengine-ark',
    description: 'Doubao Seed GUI; use the activated model ID or your Ark endpoint ID',
    config: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      api: 'openai-completions',
      apiKey: 'ARK_API_KEY',
      models: [
        { id: 'doubao-seed-2-1-pro-260915', name: 'Doubao Seed 2.1 Pro', contextWindow: 1024000, maxTokens: 4096, input: ['text', 'image'], phoneUse: { profile: 'doubao-seed-phone-v1' } },
      ],
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
  'modelscope',
  'dashscope-phone',
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
  'zai-api',
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
