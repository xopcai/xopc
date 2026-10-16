import type { ProviderSetupProfile } from '@xopcai/gateway-contract';

const subscriptionProviders = new Set([
  'qwen-token-plan-cn', 'qwen-token-plan', 'qwen-token-plan-individual',
  'xiaomi-token-plan-cn', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-sgp',
  'zai-coding-cn', 'zai-coding-global', 'zhipu-coding-cn', 'kimi-coding',
  'volcengine-plan', 'byteplus-plan', 'stepfun-plan', 'stepfun-plan-cn', 'stepfun-plan-intl',
]);

/** Plan usage is conservative until a vendor explicitly permits unattended execution. */
export function isInteractiveOnlyProvider(provider: string, baseUrl?: string): boolean {
  if (subscriptionProviders.has(provider?.trim().toLowerCase())) return true;
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    return ['token-plan.cn-beijing.maas.aliyuncs.com', 'token-plan.ap-southeast-1.maas.aliyuncs.com',
      'token-plan-cn.xiaomimimo.com', 'token-plan-ams.xiaomimimo.com', 'token-plan-sgp.xiaomimimo.com',
      'coding.dashscope.aliyuncs.com', 'coding-intl.dashscope.aliyuncs.com'].includes(hostname)
      || (['ark.cn-beijing.volces.com', 'ark.ap-southeast.bytepluses.com'].includes(hostname) && decodeURIComponent(url.pathname).startsWith('/api/coding/'));
  } catch { return false; }
}

const profiles: Record<string, Omit<ProviderSetupProfile, 'id'>> = {
  'qwen-token-plan-cn': {
    brand: 'Alibaba Bailian', name: 'Bailian subscription · Beijing', access: 'subscription', credential: 'api-key', interactiveOnly: true,
    apiKeyUrl: 'https://bailian.console.aliyun.com/cn-beijing/subscription/overview',
  },
  'xopc-cloud': { brand: 'XOPC Cloud', name: 'XOPC Cloud', access: 'account', credential: 'oauth', interactiveOnly: false },
  'xiaomi-token-plan-cn': {
    brand: 'Xiaomi MiMo', name: 'MiMo Token Plan · China', access: 'subscription', credential: 'api-key', interactiveOnly: true,
    apiKeyUrl: 'https://platform.xiaomimimo.com/',
  },
};

export function getProviderSetupProfile(provider: string, name = provider, oauth = false, baseUrl?: string): ProviderSetupProfile {
  if (profiles[provider]) return { id: provider, ...profiles[provider] };
  const interactiveOnly = isInteractiveOnlyProvider(provider, baseUrl);
  const local = Boolean(baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/.test(baseUrl));
  const brands: Record<string, string> = { 'dashscope-cn': 'Alibaba Bailian', 'dashscope-intl': 'Alibaba Bailian', 'qwen-token-plan': 'Alibaba Bailian', 'qwen-token-plan-individual': 'Alibaba Bailian', xiaomi: 'Xiaomi MiMo', 'xiaomi-token-plan-ams': 'Xiaomi MiMo', 'xiaomi-token-plan-sgp': 'Xiaomi MiMo' };
  return { id: provider, brand: brands[provider] ?? name, name, access: interactiveOnly ? 'subscription' : local ? 'local' : 'api',
    credential: oauth ? 'oauth' : local ? 'none' : 'api-key', interactiveOnly };
}
