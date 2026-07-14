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

const MIMO_MODELS: DomesticProviderModelPreset[] = [
  { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', contextWindow: 1000000, reasoning: true, input: ['text'] },
  { id: 'mimo-v2.5-pro-ultraspeed', name: 'MiMo V2.5 Pro UltraSpeed', contextWindow: 1000000, reasoning: true, input: ['text'] },
  { id: 'mimo-v2.5', name: 'MiMo V2.5', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
];

const MINIMAX_MODELS: DomesticProviderModelPreset[] = [
  { id: 'MiniMax-M3', name: 'MiniMax M3', contextWindow: 1000000, reasoning: true, input: ['text', 'image'] },
  { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 Highspeed', contextWindow: 204800, input: ['text'] },
  { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', contextWindow: 204800, input: ['text'] },
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
    id: 'deepseek',
    displayName: 'DeepSeek',
    description: 'DeepSeek models through the OpenAI-compatible API.',
    docsUrl: 'https://api-docs.deepseek.com/',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    envVars: ['DEEPSEEK_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'default', label: 'Default', baseUrl: 'https://api.deepseek.com' }],
    defaultBaseUrlPreset: 'default',
    defaultModel: 'deepseek-v4-pro',
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 1000000, maxTokens: 393216, reasoning: true, input: ['text'] },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 1000000, maxTokens: 393216, reasoning: true, input: ['text'] },
    ],
    aliases: ['deep seek', 'deepseek', 'r1'],
    quirks: ['Prefer current catalog models; older chat/reasoner aliases may be deprecated by the provider.'],
  },
  {
    id: 'moonshotai-cn',
    displayName: 'Kimi / Moonshot China',
    description: 'Kimi models through the Moonshot China OpenAI-compatible endpoint.',
    docsUrl: 'https://platform.moonshot.cn/docs',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    pricingUrl: 'https://platform.moonshot.cn/docs/pricing/chat',
    envVars: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'cn', label: 'China', baseUrl: 'https://api.moonshot.cn/v1' }],
    defaultBaseUrlPreset: 'cn',
    defaultModel: 'kimi-k2.7-code',
    models: [
      { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: 262144, maxTokens: 32768, reasoning: true, input: ['text', 'image'] },
      { id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: 128000, input: ['text'] },
    ],
    aliases: ['kimi', 'moonshot', 'moonshot cn'],
    quirks: ['Provider-specific thinking and tool-call stream fields may need compatibility handling.'],
  },
  {
    id: 'moonshotai',
    displayName: 'Kimi / Moonshot International',
    description: 'Kimi models through the Moonshot international OpenAI-compatible endpoint.',
    docsUrl: 'https://platform.moonshot.ai/docs',
    apiKeyUrl: 'https://platform.moonshot.ai/console/api-keys',
    pricingUrl: 'https://platform.moonshot.ai/docs/pricing',
    envVars: ['MOONSHOT_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'intl', label: 'International', baseUrl: 'https://api.moonshot.ai/v1' }],
    defaultBaseUrlPreset: 'intl',
    defaultModel: 'kimi-k2.7-code',
    models: [
      { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: 262144, maxTokens: 32768, reasoning: true, input: ['text', 'image'] },
      { id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: 128000, input: ['text'] },
    ],
    aliases: ['kimi intl', 'moonshot intl', 'moonshot ai'],
    quirks: ['Provider-specific thinking and tool-call stream fields may need compatibility handling.'],
  },
  {
    id: 'kimi-coding',
    displayName: 'Kimi Coding',
    description: 'Kimi dedicated coding endpoint with Anthropic-compatible requests.',
    docsUrl: 'https://platform.kimi.com/docs',
    apiKeyUrl: 'https://platform.kimi.com/console/api-keys',
    pricingUrl: 'https://platform.kimi.com/docs/pricing/chat',
    envVars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    api: 'anthropic-messages',
    headers: { 'User-Agent': 'claude-code/0.1.0' },
    baseUrlPresets: [{ id: 'coding', label: 'Coding endpoint', baseUrl: 'https://api.kimi.com/coding/' }],
    defaultBaseUrlPreset: 'coding',
    defaultModel: 'kimi-k2.7-code',
    models: [
      { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: 262144, maxTokens: 32768, reasoning: true, input: ['text', 'image'] },
      { id: 'kimi-for-coding', name: 'Kimi Code', contextWindow: 262144, maxTokens: 32768, reasoning: true, input: ['text', 'image'] },
    ],
    aliases: ['kimi coding', 'kimi code', 'moonshot coding'],
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
    id: 'xiaomi',
    displayName: 'Xiaomi MiMo',
    description: 'Xiaomi MiMo API billing endpoint through OpenAI-compatible requests.',
    docsUrl: 'https://platform.xiaomimimo.com/',
    apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
    pricingUrl: 'https://mimo.mi.com/',
    envVars: ['XIAOMI_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'api', label: 'API billing', baseUrl: 'https://api.xiaomimimo.com/v1' }],
    defaultBaseUrlPreset: 'api',
    defaultModel: 'mimo-v2.5-pro',
    models: MIMO_MODELS,
    aliases: ['xiaomi', 'mimo', 'xiaomimimo'],
    quirks: ['Some MiMo plans document api-key style auth; keep auth header behavior configurable if needed.'],
  },
  {
    id: 'xiaomi-token-plan-cn',
    displayName: 'Xiaomi MiMo Token Plan China',
    description: 'Xiaomi MiMo Token Plan China endpoint.',
    docsUrl: 'https://platform.xiaomimimo.com/',
    apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
    pricingUrl: 'https://mimo.mi.com/',
    envVars: ['XIAOMI_TOKEN_PLAN_CN_API_KEY', 'XIAOMI_TOKEN_PLAN_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'cn', label: 'China', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' }],
    defaultBaseUrlPreset: 'cn',
    defaultModel: 'mimo-v2.5-pro',
    models: MIMO_MODELS,
    aliases: ['xiaomi token plan cn', 'mimo token plan cn'],
  },
  {
    id: 'xiaomi-token-plan-ams',
    displayName: 'Xiaomi MiMo Token Plan Amsterdam',
    description: 'Xiaomi MiMo Token Plan Amsterdam endpoint.',
    docsUrl: 'https://platform.xiaomimimo.com/',
    apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
    pricingUrl: 'https://mimo.mi.com/',
    envVars: ['XIAOMI_TOKEN_PLAN_AMS_API_KEY', 'XIAOMI_TOKEN_PLAN_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'ams', label: 'Amsterdam', baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1' }],
    defaultBaseUrlPreset: 'ams',
    defaultModel: 'mimo-v2.5-pro',
    models: MIMO_MODELS,
    aliases: ['xiaomi token plan ams', 'mimo token plan ams'],
  },
  {
    id: 'xiaomi-token-plan-sgp',
    displayName: 'Xiaomi MiMo Token Plan Singapore',
    description: 'Xiaomi MiMo Token Plan Singapore endpoint.',
    docsUrl: 'https://platform.xiaomimimo.com/',
    apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
    pricingUrl: 'https://mimo.mi.com/',
    envVars: ['XIAOMI_TOKEN_PLAN_SGP_API_KEY', 'XIAOMI_TOKEN_PLAN_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'sgp', label: 'Singapore', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1' }],
    defaultBaseUrlPreset: 'sgp',
    defaultModel: 'mimo-v2.5-pro',
    models: MIMO_MODELS,
    aliases: ['xiaomi token plan sgp', 'mimo token plan sgp'],
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
    id: 'zai',
    displayName: 'Zhipu GLM International',
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
  {
    id: 'zai-coding-global',
    displayName: 'Zhipu GLM Coding Plan International',
    description: 'Zhipu GLM coding-plan international endpoint.',
    docsUrl: 'https://docs.z.ai/guides/overview/quick-start',
    apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
    pricingUrl: 'https://z.ai/manage-apikey/billing',
    envVars: ['ZAI_API_KEY', 'Z_AI_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'coding-global', label: 'Coding Global', baseUrl: 'https://api.z.ai/api/coding/paas/v4' }],
    defaultBaseUrlPreset: 'coding-global',
    defaultModel: 'glm-5.2',
    models: [
      { id: 'glm-5.2', name: 'GLM 5.2', contextWindow: 1000000, maxTokens: 65536, reasoning: true, input: ['text'] },
    ],
    aliases: ['zai coding', 'zhipu coding global', 'glm coding global'],
  },
  {
    id: 'zhipu-coding-cn',
    displayName: 'Zhipu GLM Coding Plan China',
    description: 'Zhipu GLM coding-plan China endpoint.',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview',
    apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    pricingUrl: 'https://bigmodel.cn/pricing',
    envVars: ['ZHIPU_API_KEY', 'BIGMODEL_API_KEY', 'ZAI_API_KEY'],
    api: 'openai-completions',
    baseUrlPresets: [{ id: 'coding-cn', label: 'Coding China', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4' }],
    defaultBaseUrlPreset: 'coding-cn',
    defaultModel: 'glm-5.2',
    models: [
      { id: 'glm-5.2', name: 'GLM 5.2', contextWindow: 1000000, maxTokens: 65536, reasoning: true, input: ['text'] },
    ],
    aliases: ['zhipu coding', 'glm coding cn', '智谱 coding'],
  },
  {
    id: 'minimax',
    displayName: 'MiniMax',
    description: 'MiniMax text models. Anthropic-compatible endpoint is preferred for agent/tool workflows.',
    docsUrl: 'https://platform.minimax.io/docs',
    apiKeyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    pricingUrl: 'https://platform.minimax.io/docs/guides/models-intro',
    envVars: ['MINIMAX_API_KEY'],
    api: 'anthropic-messages',
    authHeader: true,
    baseUrlPresets: [
      { id: 'intl-anthropic', label: 'International Anthropic-compatible', baseUrl: 'https://api.minimax.io/anthropic' },
      { id: 'intl-openai', label: 'International OpenAI-compatible', baseUrl: 'https://api.minimax.io/v1' },
    ],
    defaultBaseUrlPreset: 'intl-anthropic',
    defaultModel: 'MiniMax-M3',
    models: MINIMAX_MODELS,
    aliases: ['minimax', 'mini max', 'abab'],
    quirks: ['Switch API type to OpenAI-compatible if you select an /v1 endpoint.'],
  },
  {
    id: 'minimax-cn',
    displayName: 'MiniMax China',
    description: 'MiniMax China endpoint. Anthropic-compatible endpoint is preferred for agent/tool workflows.',
    docsUrl: 'https://platform.minimaxi.com/document',
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    pricingUrl: 'https://platform.minimaxi.com/document/Price',
    envVars: ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY'],
    api: 'anthropic-messages',
    authHeader: true,
    baseUrlPresets: [
      { id: 'cn-anthropic', label: 'China Anthropic-compatible', baseUrl: 'https://api.minimaxi.com/anthropic' },
      { id: 'cn-openai', label: 'China OpenAI-compatible', baseUrl: 'https://api.minimaxi.com/v1' },
    ],
    defaultBaseUrlPreset: 'cn-anthropic',
    defaultModel: 'MiniMax-M3',
    models: MINIMAX_MODELS,
    aliases: ['minimax cn', 'mini max cn', 'abab cn'],
    quirks: ['Switch API type to OpenAI-compatible if you select an /v1 endpoint.'],
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
