import type { ProviderSetupProfile } from '@xopcai/gateway-contract';

const subscriptionProviders = new Set([
  'qwen-token-plan-cn', 'qwen-token-plan', 'qwen-token-plan-individual',
  'xiaomi-token-plan-cn', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-sgp',
  'zai-coding-cn', 'zai-coding-global', 'zhipu-coding-cn', 'kimi-coding',
  'volcengine-plan', 'byteplus-plan', 'stepfun-plan', 'stepfun-plan-cn', 'stepfun-plan-intl',
]);

/** Provider identity and endpoint do not restrict background or unknown calls. */
export function isInteractiveOnlyProvider(_provider: string, _baseUrl?: string): boolean {
  return false;
}

const profiles: Record<string, Omit<ProviderSetupProfile, 'id'>> = {
  'qwen-token-plan-cn': {
    brand: 'Alibaba Bailian', name: 'Bailian subscription · Beijing', access: 'subscription', credential: 'api-key', interactiveOnly: false,
    apiKeyUrl: 'https://bailian.console.aliyun.com/cn-beijing/subscription/overview',
  },
  'xopc-cloud': { brand: 'XOPC Cloud', name: 'XOPC Cloud', access: 'account', credential: 'oauth', interactiveOnly: false },
  'xiaomi-token-plan-cn': {
    brand: 'Xiaomi MiMo', name: 'MiMo Token Plan · China', access: 'subscription', credential: 'api-key', interactiveOnly: false,
    apiKeyUrl: 'https://platform.xiaomimimo.com/',
  },
};

export function getProviderSetupProfile(provider: string, name = provider, oauth = false, baseUrl?: string): ProviderSetupProfile {
  if (profiles[provider]) return { id: provider, ...profiles[provider] };
  const interactiveOnly = isInteractiveOnlyProvider(provider, baseUrl);
  const local = Boolean(baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/.test(baseUrl));
  const brands: Record<string, string> = { 'dashscope-cn': 'Alibaba Bailian', 'dashscope-intl': 'Alibaba Bailian', 'qwen-token-plan': 'Alibaba Bailian', 'qwen-token-plan-individual': 'Alibaba Bailian', xiaomi: 'Xiaomi MiMo', 'xiaomi-token-plan-ams': 'Xiaomi MiMo', 'xiaomi-token-plan-sgp': 'Xiaomi MiMo' };
  return { id: provider, brand: brands[provider] ?? name, name, access: subscriptionProviders.has(provider.trim().toLowerCase()) ? 'subscription' : local ? 'local' : 'api',
    credential: oauth ? 'oauth' : local ? 'none' : 'api-key', interactiveOnly };
}
