import { nativeSelectMaxWidthClass, selectControlBaseClass, settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';

import type { CustomModel, ModelsJsonConfig, ProviderConfig } from '../models-json-api';

export const PROVIDER_PRESETS: Record<string, Partial<ProviderConfig>> = {
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    api: 'openai-completions',
    apiKey: 'ollama',
  },
  lmstudio: {
    baseUrl: 'http://localhost:1234/v1',
    api: 'openai-completions',
    apiKey: 'lmstudio',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    apiKey: '',
  },
  zhipuCn: {
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    api: 'openai-completions',
    apiKey: 'ZHIPU_API_KEY',
  },
  zaiGeneral: {
    baseUrl: 'https://api.z.ai/api/paas/v4',
    api: 'openai-completions',
    apiKey: 'ZAI_API_KEY',
  },
};

export function providerIdForPreset(presetKey: string): string {
  if (presetKey === 'openrouter') return 'openrouter';
  if (presetKey === 'zhipuCn') return 'zhipu-cn';
  if (presetKey === 'zaiGeneral') return 'zai';
  return presetKey;
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
  return cn(selectControlBaseClass, nativeSelectMaxWidthClass);
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
