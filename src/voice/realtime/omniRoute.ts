import { requirePlatformVoiceModel } from '../platform-catalog.js';
import { voiceSupportsMode, type VoiceProviderRoute } from '@xopcai/realtime-protocol/voice';

import type { Config } from '../../config/schema.js';
import { getProviderAuthService } from '../../providers/provider-auth-service.js';
import { BAILIAN_PLAN_HOST, BAILIAN_PLAN_PROVIDER } from '../token-plan.js';
import { resolveXopcModelRouterUrl } from '../../providers/xopc-cloud-config.js';

export interface OmniRoute {
  route: VoiceProviderRoute;
  url: string;
  apiKey: string;
  voice: string;
  instructions: string;
  maxSessionSeconds?: number;
}

export async function resolveOmniRoute(config: Config): Promise<OmniRoute> {
  const slice = config.voice?.realtime?.omni;
  if (!slice) throw new Error('Natural conversation is not configured');
  let maxSessionSeconds: number | undefined;
  let serviceVersion: number | undefined;
  if (slice.provider === 'xopc-cloud') {
    const model = requirePlatformVoiceModel(slice.model, 'conversation');
    maxSessionSeconds = model.voice.limits.maxSessionSeconds;
    serviceVersion = model.voice.serviceVersion;
    if (!model.voice.voices.some(voice => voice.id === slice.voice && voiceSupportsMode(voice, 'conversation'))) throw new Error('Selected voice is unavailable');
  }
  const managed = slice.provider === 'xopc-cloud';
  const url = new URL(managed
    ? `${resolveXopcModelRouterUrl(slice.baseUrl)}/audio/conversations/realtime`
    : slice.provider === BAILIAN_PLAN_PROVIDER ? `${BAILIAN_PLAN_HOST.replace('https:', 'wss:')}/api-ws/v1/realtime` : slice.baseUrl ?? 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime');
  if (managed && url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'wss:' || url.username || url.password || url.hash || url.port) throw new Error('Omni requires a secure WebSocket endpoint');
  if (!managed && (!(new Set(['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com']).has(url.hostname)
    || /^[a-zA-Z0-9-]+\.(cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com$/.test(url.hostname))
    || url.pathname !== '/api-ws/v1/realtime')) throw new Error('Unsupported DashScope realtime endpoint');
  const apiKey = managed || slice.provider === BAILIAN_PLAN_PROVIDER ? await getProviderAuthService().resolveApiKey(slice.provider)
    : slice.apiKey ?? config.tools?.media?.audio?.providers?.alibaba?.apiKey ?? await getProviderAuthService().resolveApiKey('dashscope');
  if (!apiKey) throw new Error('Omni credentials are unavailable');
  url.search = new URLSearchParams({ model: slice.model }).toString();
  if (serviceVersion) url.searchParams.set('service_version', String(serviceVersion));
  return { maxSessionSeconds, route: { provider: slice.provider, model: slice.model, managed }, url: url.toString(), apiKey, voice: slice.voice, instructions: slice.instructions };
}
