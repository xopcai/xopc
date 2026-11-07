import { requirePlatformVoiceModel } from '../platform-catalog.js';
import { HIGGS_REALTIME_REF, voiceSupportsMode, type HiggsVoice, type VoiceCallPreferences, type VoiceProviderRoute } from '@xopcai/realtime-protocol/voice';

import type { Config } from '../../config/schema.js';
import { getProviderAuthService } from '../../providers/provider-auth-service.js';
import { getCredentialResolver } from '../../auth/credentials.js';
import { BAILIAN_PLAN_HOST, BAILIAN_PLAN_PROVIDER } from '../token-plan.js';
import { resolveXopcModelRouterUrl } from '../../providers/xopc-cloud-config.js';

export interface OmniRoute {
  route: VoiceProviderRoute;
  url: string;
  apiKey: string;
  voice: string;
  instructions: string;
  tools?: boolean;
  maxSessionSeconds?: number;
}

export function legacyNaturalModel(config: Config): string | undefined {
  const model = config.voice?.realtime?.omni;
  return model ? `${model.provider}/${model.model}` : undefined;
}

export function selectedNaturalModel(config: Config, preferences?: VoiceCallPreferences): string | undefined {
  return preferences?.naturalModel ?? (config.voice?.realtime?.boson?.defaultForNatural ? HIGGS_REALTIME_REF : legacyNaturalModel(config));
}

export async function resolveHiggsRoute(config: Config, voice?: HiggsVoice): Promise<OmniRoute> {
  const apiKey = await getCredentialResolver().resolveApiKey('boson');
  if (!apiKey) throw new Error('Boson API key is unavailable');
  return {
    route: { provider: 'boson', model: 'higgs-realtime', managed: false },
    url: 'wss://api.boson.ai/v1/realtime?model=higgs-realtime',
    apiKey,
    voice: voice ?? config.voice.realtime.boson?.voice ?? 'default',
    instructions: 'You are Ada. Speak naturally in the user’s language. Start with the answer, skip greetings and filler, and use one brief sentence unless the user asks for detail.',
    tools: true,
    maxSessionSeconds: 3600,
  };
}

export async function resolveOmniRoute(config: Config, model = selectedNaturalModel(config), voice?: HiggsVoice): Promise<OmniRoute> {
  if (model === HIGGS_REALTIME_REF) return resolveHiggsRoute(config, voice);
  let slice = config.voice?.realtime?.omni;
  if (model?.startsWith('xopc-cloud/')) {
    const id = model.slice('xopc-cloud/'.length);
    const published = requirePlatformVoiceModel(id, 'conversation');
    const voices = published.voice.voices.filter(item => voiceSupportsMode(item, 'conversation'));
    const selected = slice?.provider === 'xopc-cloud' && slice.model === id ? slice : undefined;
    const selectedVoice = selected?.voice ?? voices.find(item => item.id === published.voice.defaultVoice)?.id ?? voices[0]?.id;
    if (!selectedVoice) throw new Error('Selected voice is unavailable');
    slice = { ...selected, provider: 'xopc-cloud', model: id, voice: selectedVoice,
      instructions: selected?.instructions ?? 'Keep replies conversational and concise.' };
  } else if (!slice || model !== legacyNaturalModel(config)) {
    throw new Error('Selected natural voice model is unavailable');
  }
  let maxSessionSeconds: number | undefined;
  let serviceVersion: number | undefined;
  let tools = /^(?:qwen3\.[58]-omni-(?:flash|plus)-realtime)(?:-|$)/u.test(slice.model);
  if (slice.provider === 'xopc-cloud') {
    const model = requirePlatformVoiceModel(slice.model, 'conversation');
    maxSessionSeconds = model.voice.limits.maxSessionSeconds;
    serviceVersion = model.voice.serviceVersion;
    tools = model.voice.tools;
    if (!model.voice.voices.some(voice => voice.id === slice.voice && voiceSupportsMode(voice, 'conversation'))) throw new Error('Selected voice is unavailable');
  }
  const managed = slice.provider === 'xopc-cloud';
  const legacyInstructions = [
    'Keep replies conversational and concise. You cannot execute tools.',
    'You are a friendly voice companion. Keep replies conversational and concise. You cannot execute tools or perform actions.',
  ];
  const instructions = tools && legacyInstructions.includes(slice.instructions)
    ? 'Keep replies conversational and concise.' : slice.instructions;
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
  return { maxSessionSeconds, tools, route: { provider: slice.provider, model: slice.model, managed }, url: url.toString(), apiKey, voice: slice.voice, instructions };
}
