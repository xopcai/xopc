import type { ProvidersSettingsMessages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

export interface ProviderEnrichment {
  /**
   * API key console for **this** provider id’s region.
   * When the codebase uses separate ids for intl vs China (e.g. `minimax` / `minimax-cn`),
   * only set this field — do not add {@link apiKeyUrlCn} on those rows.
   */
  apiKeyUrl?: string;
  /**
   * Extra China console only for a **single** provider id that spans regions (e.g. Qwen/DashScope).
   * Omit when regions are already split into separate provider ids.
   */
  apiKeyUrlCn?: string;
  /** URL to the provider's pricing page. */
  pricingUrl?: string;
  /** URL to the provider's API documentation. */
  docsUrl?: string;
  /** Short one-line description (English). */
  description?: string;
  /** Short one-line description (Chinese). Shown when language === 'zh'. */
  descriptionZh?: string;
  /** Tags describing what this provider excels at. */
  bestFor?: string[];
  /** Whether the provider has a meaningful free tier. */
  freeTier?: boolean;
  /** Human-readable free tier note. */
  freeTierNote?: string;
  /** Common aliases users might type in search (all lowercase). */
  aliases?: string[];
  /**
   * Environment variable names for this provider.
   * Client-side copy of src/providers/env-keys.ts PROVIDER_ENV_MAP.
   * Keep in sync when PROVIDER_ENV_MAP changes.
   */
  envVars?: string[];
}

export type ApiKeyLinkKind = 'intl' | 'cn' | 'single';

/** Label for one row in the “Get API Key” link group. */
export function providerApiKeyLinkLabel(
  kind: ApiKeyLinkKind,
  labels: Pick<ProvidersSettingsMessages, 'getApiKey' | 'getApiKeyIntl' | 'getApiKeyCn'>,
): string {
  if (kind === 'single') return labels.getApiKey;
  return kind === 'intl' ? labels.getApiKeyIntl : labels.getApiKeyCn;
}

/**
 * Enrichment data keyed by provider id (matches ProviderMeta.id from /api/providers/meta).
 * Covers all providers in PROVIDER_ENV_MAP plus additional managed providers.
 */
export const PROVIDER_ENRICHMENT: Record<string, ProviderEnrichment> = {
  openai: {
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    pricingUrl: 'https://openai.com/pricing',
    docsUrl: 'https://platform.openai.com/docs',
    description: 'The most widely used LLM provider. Powers ChatGPT.',
    descriptionZh: '最广泛使用的 LLM 服务商，ChatGPT 背后的技术。',
    bestFor: ['general', 'coding', 'vision'],
    freeTier: false,
    freeTierNote: 'Pay-as-you-go; new accounts may receive trial credits.',
    aliases: ['chatgpt', 'gpt', 'gpt-4', 'gpt4', 'gpt-4o', 'gpt4o'],
    envVars: ['OPENAI_API_KEY'],
  },
  anthropic: {
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    pricingUrl: 'https://www.anthropic.com/pricing',
    docsUrl: 'https://docs.anthropic.com',
    description: 'Known for Claude — excellent at long documents, coding, and nuanced reasoning.',
    descriptionZh: 'Claude 系列模型，擅长长文档处理、代码和复杂推理。',
    bestFor: ['long context', 'coding', 'reasoning'],
    freeTier: false,
    aliases: ['claude', 'claude 3', 'claude sonnet', 'claude opus', 'claude haiku'],
    envVars: ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  },
  google: {
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    pricingUrl: 'https://ai.google.dev/pricing',
    docsUrl: 'https://ai.google.dev/docs',
    description: 'Google Gemini models — strong multimodal and long-context capabilities.',
    descriptionZh: 'Google Gemini 系列，多模态能力强，支持超长上下文。',
    bestFor: ['multimodal', 'long context', 'general'],
    freeTier: true,
    freeTierNote: 'Free tier available via Google AI Studio.',
    aliases: ['gemini', 'google gemini', 'bard', 'google ai'],
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  },
  'google-vertex': {
    apiKeyUrl: 'https://console.cloud.google.com/apis/credentials',
    pricingUrl: 'https://cloud.google.com/vertex-ai/pricing',
    docsUrl: 'https://cloud.google.com/vertex-ai/docs',
    description: 'Google Vertex AI — enterprise-grade Gemini and other models on GCP.',
    descriptionZh: 'Google Vertex AI，企业级 GCP 托管模型，支持 Gemini 等。',
    bestFor: ['enterprise', 'multimodal', 'compliance'],
    freeTier: false,
    aliases: ['vertex', 'vertex ai', 'gcp', 'google cloud'],
    envVars: ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION'],
  },
  'google-gemini-cli': {
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    pricingUrl: 'https://ai.google.dev/pricing',
    docsUrl: 'https://ai.google.dev/docs',
    description: 'Gemini via CLI token — for users authenticated with the Gemini CLI tool.',
    descriptionZh: '通过 Gemini CLI 令牌访问 Gemini，适合已安装 CLI 工具的用户。',
    bestFor: ['general', 'multimodal'],
    freeTier: true,
    freeTierNote: 'Uses your existing Gemini CLI authentication.',
    aliases: ['gemini cli', 'gemini-cli'],
    envVars: ['GEMINI_CLI_TOKEN', 'GOOGLE_TOKEN'],
  },
  'google-antigravity': {
    apiKeyUrl: 'https://console.cloud.google.com/apis/credentials',
    pricingUrl: 'https://cloud.google.com/pricing',
    docsUrl: 'https://cloud.google.com/docs',
    description: 'Google Antigravity — internal/experimental Google AI endpoint.',
    descriptionZh: 'Google Antigravity，Google 内部/实验性 AI 端点。',
    bestFor: ['experimental'],
    freeTier: false,
    aliases: ['antigravity', 'google antigravity'],
    envVars: ['ANTIGRAVITY_API_KEY'],
  },
  groq: {
    apiKeyUrl: 'https://console.groq.com/keys',
    pricingUrl: 'https://groq.com/pricing/',
    docsUrl: 'https://console.groq.com/docs',
    description: 'Extremely fast inference — ideal for latency-sensitive applications.',
    descriptionZh: '推理速度极快，适合对延迟敏感的场景。',
    bestFor: ['speed', 'cheap'],
    freeTier: true,
    freeTierNote: 'Generous free tier with rate limits.',
    aliases: ['groq', 'llama on groq', 'mixtral on groq'],
    envVars: ['GROQ_API_KEY'],
  },
  deepseek: {
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing/',
    docsUrl: 'https://platform.deepseek.com/api-docs/',
    description: 'DeepSeek models — OpenAI-compatible API with strong reasoning and low costs.',
    descriptionZh: 'DeepSeek 模型：OpenAI 兼容 API，推理强、成本低。',
    bestFor: ['reasoning', 'cheap', 'coding'],
    freeTier: true,
    freeTierNote: 'Free credits may be available for new accounts.',
    aliases: ['deepseek', 'deep seek', 'deepseek v4', 'deepseek-v4', 'r1'],
    envVars: ['DEEPSEEK_API_KEY'],
  },
  xai: {
    apiKeyUrl: 'https://console.x.ai/',
    pricingUrl: 'https://x.ai/api',
    docsUrl: 'https://docs.x.ai/',
    description: 'xAI Grok models — real-time web access, strong reasoning.',
    descriptionZh: 'xAI Grok 系列，支持实时联网，推理能力强。',
    bestFor: ['reasoning', 'real-time'],
    freeTier: false,
    aliases: ['grok', 'xai', 'x.ai'],
    envVars: ['XAI_API_KEY'],
  },
  cerebras: {
    apiKeyUrl: 'https://cloud.cerebras.ai/platform/',
    pricingUrl: 'https://cloud.cerebras.ai/platform/',
    docsUrl: 'https://inference-docs.cerebras.ai/',
    description: 'Ultra-fast inference on custom AI chips. Fastest Llama inference available.',
    descriptionZh: '基于专用 AI 芯片的超快推理，Llama 推理速度业界最快。',
    bestFor: ['speed'],
    freeTier: true,
    freeTierNote: 'Free tier available.',
    aliases: ['cerebras'],
    envVars: ['CEREBRAS_API_KEY'],
  },
  mistral: {
    apiKeyUrl: 'https://console.mistral.ai/api-keys/',
    pricingUrl: 'https://mistral.ai/technology/#pricing',
    docsUrl: 'https://docs.mistral.ai/',
    description: 'European open-weight models. Good balance of quality and cost.',
    descriptionZh: '欧洲开源模型，质量与成本平衡好。',
    bestFor: ['general', 'cheap', 'coding'],
    freeTier: false,
    aliases: ['mistral', 'mixtral', 'codestral'],
    envVars: ['MISTRAL_API_KEY'],
  },
  openrouter: {
    apiKeyUrl: 'https://openrouter.ai/keys',
    pricingUrl: 'https://openrouter.ai/models',
    docsUrl: 'https://openrouter.ai/docs',
    description: 'API gateway to 100+ models from many providers with a single key.',
    descriptionZh: '统一 API 网关，一个 Key 访问 100+ 模型。',
    bestFor: ['general', 'flexibility'],
    freeTier: true,
    freeTierNote: 'Some models are free; pay-per-use for others.',
    aliases: ['openrouter', 'open router'],
    envVars: ['OPENROUTER_API_KEY'],
  },
  'azure-openai-responses': {
    apiKeyUrl: 'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI',
    pricingUrl: 'https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/',
    description: 'OpenAI models hosted on Azure. Enterprise SLA and data residency.',
    descriptionZh: 'Azure 托管的 OpenAI 模型，企业级 SLA 和数据合规。',
    bestFor: ['enterprise', 'compliance', 'coding'],
    freeTier: false,
    aliases: ['azure', 'azure openai', 'aoai'],
    envVars: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_BASE_URL'],
  },
  'amazon-bedrock': {
    apiKeyUrl: 'https://console.aws.amazon.com/iam/home#/security_credentials',
    pricingUrl: 'https://aws.amazon.com/bedrock/pricing/',
    docsUrl: 'https://docs.aws.amazon.com/bedrock/',
    description: 'AWS-hosted models including Claude, Llama, Titan. Enterprise-grade.',
    descriptionZh: 'AWS 托管模型，包含 Claude、Llama 等，企业级可靠性。',
    bestFor: ['enterprise', 'compliance'],
    freeTier: false,
    aliases: ['bedrock', 'aws', 'amazon'],
    envVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
  },
  minimax: {
    apiKeyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    pricingUrl: 'https://platform.minimax.io/docs/guides/models-intro',
    docsUrl: 'https://platform.minimax.io/docs/guides/quickstart-preparation',
    description: 'MiniMax — Chinese multimodal model with strong text and audio capabilities.',
    descriptionZh: 'MiniMax，国产多模态模型，文本和音频能力强。',
    bestFor: ['multimodal', 'chinese'],
    freeTier: true,
    freeTierNote: '注册赠送免费额度。',
    aliases: ['minimax', 'mini max', 'abab'],
    envVars: ['MINIMAX_API_KEY'],
  },
  'minimax-cn': {
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    pricingUrl: 'https://platform.minimaxi.com/document/Price',
    docsUrl: 'https://platform.minimaxi.com/document/Announcement',
    description: 'MiniMax (China endpoint) — domestic access for Chinese users.',
    descriptionZh: 'MiniMax 国内端点，国内用户直连访问。',
    bestFor: ['multimodal', 'chinese'],
    freeTier: true,
    freeTierNote: '注册赠送免费额度。',
    aliases: ['minimax cn', 'minimax china', 'abab'],
    envVars: ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY'],
  },
  'kimi-coding': {
    apiKeyUrl: 'https://platform.moonshot.ai/console/api-keys',
    apiKeyUrlCn: 'https://platform.moonshot.cn/console/api-keys',
    pricingUrl: 'https://platform.moonshot.ai/docs/pricing/chat',
    docsUrl: 'https://platform.moonshot.ai/docs',
    description: 'Kimi Coding — Moonshot model optimized for code generation tasks.',
    descriptionZh: 'Kimi Coding，Moonshot 专为代码生成优化的模型。',
    bestFor: ['coding', 'chinese'],
    freeTier: true,
    freeTierNote: '注册赠送免费额度。',
    aliases: ['kimi coding', 'moonshot coding', 'kimi code'],
    envVars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
  },
  huggingface: {
    apiKeyUrl: 'https://huggingface.co/settings/tokens',
    pricingUrl: 'https://huggingface.co/pricing',
    docsUrl: 'https://huggingface.co/docs/api-inference/',
    description: 'Access thousands of open-source models via Hugging Face Inference API.',
    descriptionZh: '通过 Hugging Face 访问数千个开源模型。',
    bestFor: ['open source', 'flexibility'],
    freeTier: true,
    freeTierNote: 'Free tier with rate limits.',
    aliases: ['huggingface', 'hugging face', 'hf'],
    envVars: ['HF_TOKEN', 'HUGGINGFACE_TOKEN'],
  },
  opencode: {
    apiKeyUrl: 'https://opencode.ai/auth',
    pricingUrl: 'https://opencode.ai/docs',
    docsUrl: 'https://opencode.ai/docs/providers/',
    description: 'OpenCode — AI coding assistant provider.',
    descriptionZh: 'OpenCode，AI 代码助手服务商。',
    bestFor: ['coding'],
    freeTier: false,
    aliases: ['opencode', 'open code'],
    envVars: ['OPENCODE_API_KEY'],
  },
  'opencode-go': {
    apiKeyUrl: 'https://opencode.ai/auth',
    pricingUrl: 'https://opencode.ai/docs',
    docsUrl: 'https://opencode.ai/docs/providers/',
    description: 'OpenCode Go — AI coding assistant provider (Go variant).',
    descriptionZh: 'OpenCode Go，AI 代码助手服务商（Go 版本）。',
    bestFor: ['coding'],
    freeTier: false,
    aliases: ['opencode go', 'opencode-go'],
    envVars: ['OPENCODE_API_KEY'],
  },
  zai: {
    apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
    pricingUrl: 'https://z.ai/manage-apikey/billing',
    docsUrl: 'https://docs.z.ai/guides/overview/quick-start',
    description: '01.AI Yi models — strong multilingual capabilities.',
    descriptionZh: '零一万物 Yi 系列模型，多语言能力强。',
    bestFor: ['general', 'chinese'],
    freeTier: false,
    aliases: ['yi', '01.ai', 'zero one', '零一万物'],
    envVars: ['ZAI_API_KEY'],
  },
  dashscope: {
    apiKeyUrl: 'https://modelstudio.console.alibabacloud.com/',
    apiKeyUrlCn: 'https://dashscope.console.aliyun.com/apiKey',
    pricingUrl: 'https://help.aliyun.com/zh/dashscope/developer-reference/tongyi-thousand-questions-metering-and-billing',
    docsUrl: 'https://help.aliyun.com/zh/dashscope/',
    description:
      'Alibaba DashScope — image generation, speech, and STT HTTP APIs (service id `dashscope`, not a pi-ai LLM provider).',
    descriptionZh: '阿里 DashScope：文生图、语音等 HTTP API（服务 id 为 dashscope，非 pi-ai 内置 LLM）。',
    bestFor: ['image', 'speech', 'chinese'],
    freeTier: true,
    aliases: ['dash scope', 'alibaba dashscope'],
    envVars: ['DASHSCOPE_API_KEY'],
  },
  'vercel-ai-gateway': {
    apiKeyUrl: 'https://vercel.com/account/tokens',
    pricingUrl: 'https://vercel.com/pricing',
    docsUrl: 'https://vercel.com/docs/ai/ai-gateway',
    description: 'Vercel AI Gateway — route requests to multiple LLM providers via Vercel.',
    descriptionZh: 'Vercel AI Gateway，通过 Vercel 路由请求到多个 LLM 服务商。',
    bestFor: ['flexibility', 'enterprise'],
    freeTier: false,
    aliases: ['vercel gateway', 'vercel ai gateway'],
    envVars: ['AI_GATEWAY_API_KEY', 'VERCEL_AI_GATEWAY_API_KEY'],
  },
  'github-copilot': {
    apiKeyUrl: 'https://github.com/settings/tokens',
    pricingUrl: 'https://github.com/features/copilot#pricing',
    docsUrl: 'https://docs.github.com/en/copilot',
    description: 'GitHub Copilot — use your GitHub token to access Copilot models.',
    descriptionZh: '使用 GitHub 令牌访问 Copilot 模型。',
    bestFor: ['coding'],
    freeTier: true,
    freeTierNote: 'Free for verified students and open-source maintainers.',
    aliases: ['github copilot', 'copilot', 'github'],
    envVars: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_COPILOT_TOKEN'],
  },
};

/**
 * Ordered API key console links for UI. {@link ProviderEnrichment.apiKeyUrlCn} is only set when one
 * provider id covers both regions; otherwise each id uses {@link ProviderEnrichment.apiKeyUrl} alone
 * (e.g. `minimax` vs `minimax-cn`). When both exist, order follows UI language (domestic first in zh).
 */
export function getOrderedApiKeyLinks(
  providerId: string,
  language: StoredLanguage,
): { href: string; kind: ApiKeyLinkKind }[] {
  const e = PROVIDER_ENRICHMENT[providerId];
  if (!e) return [];
  const intl = e.apiKeyUrl;
  const cn = e.apiKeyUrlCn;
  if (intl && cn) {
    if (language === 'zh') {
      return [
        { href: cn, kind: 'cn' },
        { href: intl, kind: 'intl' },
      ];
    }
    return [
      { href: intl, kind: 'intl' },
      { href: cn, kind: 'cn' },
    ];
  }
  if (intl) return [{ href: intl, kind: 'single' }];
  if (cn) return [{ href: cn, kind: 'single' }];
  return [];
}
