import type { VoiceProviderRoute } from '@xopcai/realtime-protocol/voice';

import type { Config } from '../../config/schema.js';
import { getProviderAuthService } from '../../providers/provider-auth-service.js';
import { resolveXopcModelRouterUrl } from '../../providers/xopc-cloud-config.js';

export interface OmniRoute {
  route: VoiceProviderRoute;
  url: string;
  apiKey: string;
  voice: string;
  instructions: string;
}

export async function resolveOmniRoute(config: Config): Promise<OmniRoute> {
  const slice = config.voice?.realtime?.omni;
  if (!slice) throw new Error('Natural conversation is not configured');
  if (slice.model !== 'qwen3-omni-flash-realtime') throw new Error('This Omni model has not been certified');
  const managed = slice.provider === 'xopc-cloud';
  const url = new URL(managed
    ? `${resolveXopcModelRouterUrl(slice.baseUrl)}/audio/conversations/realtime`
    : slice.baseUrl ?? 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime');
  if (managed && url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'wss:' || url.username || url.password || url.hash || url.port) throw new Error('Omni requires a secure WebSocket endpoint');
  if (!managed && (!(new Set(['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com']).has(url.hostname)
    || /^[a-zA-Z0-9-]+\.(cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com$/.test(url.hostname))
    || url.pathname !== '/api-ws/v1/realtime')) throw new Error('Unsupported DashScope realtime endpoint');
  const apiKey = managed ? await getProviderAuthService().resolveApiKey('xopc-cloud')
    : slice.apiKey ?? await getProviderAuthService().resolveApiKey('dashscope');
  if (!apiKey) throw new Error('Omni credentials are unavailable');
  url.search = new URLSearchParams({ model: slice.model }).toString();
  return { route: { provider: slice.provider, model: slice.model, managed }, url: url.toString(), apiKey, voice: slice.voice, instructions: slice.instructions };
}
