import type { ProviderConfig } from '../config/models-json.js';

export interface DomesticProviderModelPreset {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
}

export interface DomesticProviderBaseUrlPreset {
  id: string;
  label: string;
  baseUrl: string;
  description?: string;
}

export interface DomesticProviderPreset {
  id: string;
  displayName: string;
  description: string;
  docsUrl: string;
  apiKeyUrl: string;
  pricingUrl?: string;
  envVars: string[];
  api: NonNullable<ProviderConfig['api']>;
  authHeader?: boolean;
  headers?: Record<string, string>;
  baseUrlPresets: DomesticProviderBaseUrlPreset[];
  defaultBaseUrlPreset: string;
  defaultModel: string;
  models: DomesticProviderModelPreset[];
  aliases: string[];
  quirks?: string[];
  onboardingIcon?: string;
  requiresModelDiscovery?: boolean;
}

const QWEN_MODELS: DomesticProviderModelPreset[] = [
  { id: 'qwen3.7-max', name: 'Qwen3.7 Max', contextWindow: 1000000, input: ['text', 'image'] },
  { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', contextWindow: 1000000, input: ['text', 'image'] },
  { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash', contextWindow: 1000000, input: ['text'] },
];

const STEPFUN_MODELS: DomesticProviderModelPreset[] = [
  { id: 'step-3.7-flash', name: 'Step 3.7 Flash', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
  { id: 'step-3.5-flash-2603', name: 'Step 3.5 Flash 2603', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
  { id: 'step-3.5-flash', name: 'Step 3.5 Flash', contextWindow: 1000000, reasoning: true, input: ['text'] },
];

export const DOMESTIC_PROVIDER_PRESETS = [
  {
    id: 'dashscope-cn',
    displayName: 'Alibaba Bailian / DashScope China',
    description: 'Alibaba Bailian Qwen models through the China DashScope OpenAI-compatible endpoint.',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope',
    apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    pricingUrl: 'https://help.aliyun.com/zh/model-studio/developer-reference/tongyi-thousand-questions-metering-and-billing',
    envVars: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [
      {
        id: 'cn',
        label: 'China',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
    ],
    defaultBaseUrlPreset: 'cn',
    defaultModel: 'qwen3.7-plus',
    models: QWEN_MODELS,
    aliases: ['qwen', 'tongyi', 'aliyun', 'bailian', 'dashscope', 'dashscope cn', '阿里百炼'],
    quirks: ['Some Qwen coding endpoints use different hosts; keep the Base URL editable.'],
  },
  {
    id: 'dashscope-intl',
    displayName: 'Alibaba Bailian / DashScope International',
    description: 'Alibaba Bailian Qwen models through the international DashScope OpenAI-compatible endpoint.',
    docsUrl: 'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope',
    apiKeyUrl: 'https://modelstudio.console.alibabacloud.com/',
    pricingUrl: 'https://www.alibabacloud.com/help/en/model-studio/billing-for-tongyi-qianwen',
    envVars: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [
      {
        id: 'intl',
        label: 'International',
        baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      },
    ],
    defaultBaseUrlPreset: 'intl',
    defaultModel: 'qwen3.7-plus',
    models: QWEN_MODELS,
    aliases: ['qwen intl', 'tongyi intl', 'alibaba cloud', 'dashscope intl'],
    quirks: ['Use an international DashScope key for the international endpoint.'],
  },
  {
    id: 'volcengine-ark',
    displayName: 'Volcengine Ark',
    description: 'Volcengine Ark models through the OpenAI-compatible API.',
    docsUrl: 'https://www.volcengine.com/docs/82379/1302008',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    envVars: ['ARK_API_KEY', 'VOLCENGINE_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [
      {
        id: 'cn-beijing',
        label: 'China Beijing',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        description: 'Model IDs are usually Ark endpoint IDs.',
      },
    ],
    defaultBaseUrlPreset: 'cn-beijing',
    defaultModel: 'ep-your-endpoint-id',
    models: [{ id: 'ep-your-endpoint-id', name: 'Ark endpoint ID', contextWindow: 128000, input: ['text'] }],
    aliases: ['doubao', 'ark', 'volcengine', 'volces', 'bytedance'],
    quirks: ['Use the Ark endpoint id as the model id.'],
  },
  {
    id: 'volcengine-plan',
    displayName: 'Volcengine Doubao Coding Plan',
    description: 'Doubao coding-plan models through Volcengine Ark coding endpoint.',
    docsUrl: 'https://www.volcengine.com/docs/82379/1302008',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    envVars: ['ARK_API_KEY', 'VOLCENGINE_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [
      { id: 'cn-beijing-coding', label: 'China Beijing Coding Plan', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3' },
    ],
    defaultBaseUrlPreset: 'cn-beijing-coding',
    defaultModel: 'ark-code-latest',
    models: [
      { id: 'ark-code-latest', name: 'Ark Coding Plan', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
      { id: 'doubao-seed-2.0-code', name: 'Doubao Seed 2.0 Code', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
      { id: 'doubao-seed-2.0-pro', name: 'Doubao Seed 2.0 Pro', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
      { id: 'doubao-seed-2.0-lite', name: 'Doubao Seed 2.0 Lite', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
    ],
    aliases: ['doubao coding', 'volcengine plan', 'ark coding plan', '火山方舟 coding'],
  },
  {
    id: 'byteplus-plan',
    displayName: 'BytePlus Doubao Coding Plan',
    description: 'Doubao coding-plan models through the BytePlus international coding endpoint.',
    docsUrl: 'https://docs.byteplus.com/en/docs/ModelArk/OpenAI',
    apiKeyUrl: 'https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey',
    envVars: ['BYTEPLUS_API_KEY', 'ARK_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [
      { id: 'ap-southeast-coding', label: 'Asia Pacific Coding Plan', baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3' },
    ],
    defaultBaseUrlPreset: 'ap-southeast-coding',
    defaultModel: 'ark-code-latest',
    models: [
      { id: 'ark-code-latest', name: 'Ark Coding Plan', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
      { id: 'doubao-seed-2.0-code', name: 'Doubao Seed 2.0 Code', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
      { id: 'doubao-seed-2.0-pro', name: 'Doubao Seed 2.0 Pro', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
      { id: 'doubao-seed-2.0-lite', name: 'Doubao Seed 2.0 Lite', contextWindow: 256000, maxTokens: 4096, input: ['text'] },
    ],
    aliases: ['byteplus', 'byteplus plan', 'doubao coding international'],
  },
  {
    id: 'stepfun-intl',
    displayName: 'StepFun International',
    description: 'StepFun models through the international OpenAI-compatible API.',
    docsUrl: 'https://platform.stepfun.com/docs',
    apiKeyUrl: 'https://platform.stepfun.com/interface-key',
    envVars: ['STEPFUN_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'intl', label: 'International', baseUrl: 'https://api.stepfun.ai/v1' }],
    defaultBaseUrlPreset: 'intl',
    defaultModel: 'step-3.7-flash',
    models: STEPFUN_MODELS,
    aliases: ['step', 'stepfun', 'jieyue', 'stepfun intl'],
  },
  {
    id: 'stepfun-cn',
    displayName: 'StepFun China',
    description: 'StepFun models through the China OpenAI-compatible API.',
    docsUrl: 'https://platform.stepfun.com/docs',
    apiKeyUrl: 'https://platform.stepfun.com/interface-key',
    envVars: ['STEPFUN_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'cn', label: 'China', baseUrl: 'https://api.stepfun.com/v1' }],
    defaultBaseUrlPreset: 'cn',
    defaultModel: 'step-3.7-flash',
    models: STEPFUN_MODELS,
    aliases: ['step cn', 'stepfun cn', 'jieyue cn', '阶跃星辰'],
  },
  {
    id: 'stepfun-plan-intl',
    displayName: 'StepFun Step Plan International',
    description: 'StepFun Step Plan international coding/planning endpoint.',
    docsUrl: 'https://platform.stepfun.com/docs',
    apiKeyUrl: 'https://platform.stepfun.com/interface-key',
    envVars: ['STEPFUN_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'plan-intl', label: 'Step Plan International', baseUrl: 'https://api.stepfun.ai/step_plan/v1' }],
    defaultBaseUrlPreset: 'plan-intl',
    defaultModel: 'step-3.7-flash',
    models: STEPFUN_MODELS,
    aliases: ['step plan', 'stepfun plan', 'stepfun plan intl'],
  },
  {
    id: 'stepfun-plan-cn',
    displayName: 'StepFun Step Plan China',
    description: 'StepFun Step Plan China coding/planning endpoint.',
    docsUrl: 'https://platform.stepfun.com/docs',
    apiKeyUrl: 'https://platform.stepfun.com/interface-key',
    envVars: ['STEPFUN_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'plan-cn', label: 'Step Plan China', baseUrl: 'https://api.stepfun.com/step_plan/v1' }],
    defaultBaseUrlPreset: 'plan-cn',
    defaultModel: 'step-3.7-flash',
    models: STEPFUN_MODELS,
    aliases: ['step plan cn', 'stepfun plan cn', '阶跃 plan'],
  },
  {
    id: 'zhipu-cn',
    displayName: 'Zhipu GLM China',
    description: 'Zhipu GLM models through the BigModel OpenAI-compatible API.',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview',
    apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    pricingUrl: 'https://bigmodel.cn/pricing',
    envVars: ['ZHIPU_API_KEY', 'BIGMODEL_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'cn', label: 'China', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }],
    defaultBaseUrlPreset: 'cn',
    defaultModel: 'glm-5.2',
    models: [
      { id: 'glm-5.2', name: 'GLM 5.2', contextWindow: 1000000, maxTokens: 65536, reasoning: true, input: ['text'] },
    ],
    aliases: ['zhipu', 'glm', 'bigmodel', 'zai cn'],
  },
  {
    id: 'zai-api',
    displayName: 'Zhipu GLM API (International)',
    description: 'Zhipu GLM models through the z.ai OpenAI-compatible endpoint.',
    docsUrl: 'https://docs.z.ai/guides/overview/quick-start',
    apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
    pricingUrl: 'https://z.ai/manage-apikey/billing',
    envVars: ['ZAI_API_KEY', 'Z_AI_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'global', label: 'International', baseUrl: 'https://api.z.ai/api/paas/v4' }],
    defaultBaseUrlPreset: 'global',
    defaultModel: 'glm-5.2',
    models: [
      { id: 'glm-5.2', name: 'GLM 5.2', contextWindow: 1000000, maxTokens: 65536, reasoning: true, input: ['text'] },
    ],
    aliases: ['zai', 'z.ai', 'zhipu global', 'glm global'],
  },
] as const satisfies readonly DomesticProviderPreset[];

const PRESET_BY_ID = new Map<string, DomesticProviderPreset>(
  DOMESTIC_PROVIDER_PRESETS.map((preset) => [preset.id, preset]),
);

export function getDomesticProviderPreset(id: string): DomesticProviderPreset | undefined {
  return PRESET_BY_ID.get(id);
}

export function getDomesticProviderPresetIds(): string[] {
  return DOMESTIC_PROVIDER_PRESETS.map((preset) => preset.id);
}

export function getDomesticProviderBaseUrl(preset: DomesticProviderPreset): string {
  return (
    preset.baseUrlPresets.find((entry) => entry.id === preset.defaultBaseUrlPreset)?.baseUrl ??
    preset.baseUrlPresets[0]?.baseUrl ??
    ''
  );
}

export function providerConfigFromDomesticPreset(
  preset: DomesticProviderPreset,
  params: { apiKey?: string; baseUrl?: string; modelIds?: string[] } = {},
): ProviderConfig {
  const ids = params.modelIds?.length ? params.modelIds : preset.models.map((model) => model.id);
  return {
    baseUrl: params.baseUrl ?? getDomesticProviderBaseUrl(preset),
    apiKey: params.apiKey,
    api: preset.api,
    ...(preset.authHeader === undefined ? {} : { authHeader: preset.authHeader }),
    ...(preset.headers ? { headers: preset.headers } : {}),
    models: ids.map((id) => {
      const model = preset.models.find((entry) => entry.id === id);
      return {
        id,
        name: model?.name ?? id,
        api: preset.api,
        ...(model?.contextWindow ? { contextWindow: model.contextWindow } : {}),
        ...(model?.maxTokens ? { maxTokens: model.maxTokens } : {}),
        ...(model?.reasoning ? { reasoning: model.reasoning } : {}),
        input: model?.input ?? ['text'],
      };
    }),
  };
}
