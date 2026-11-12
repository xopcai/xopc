import type { MusicModelSettings } from '@xopcai/gateway-contract';

import { murekaGlobalProvider, murekaProvider } from './mureka.js';
import type { MusicProvider } from './provider.js';
import { getMusicDefaults, musicCredentials, storedMusicModel } from './settings.js';

const providers = new Map<string, MusicProvider>([murekaProvider, murekaGlobalProvider].map(provider => [provider.id, provider]));
export const DEFAULT_MUSIC_MODEL = 'mureka-cn/mureka-9.5';

export function resolveMusicModel(ref: string) {
  const [providerId, model, extra] = ref.split('/');
  const provider = providers.get(providerId);
  if (!model || extra !== undefined || !provider || !Object.hasOwn(provider.models, model)) return undefined;
  return { provider, model, capabilities: provider.models[model] };
}

function selectedMusicModel(): string {
  const ref = storedMusicModel() ?? process.env.XOPC_MUSIC_MODEL?.trim();
  return ref && resolveMusicModel(ref) ? ref : DEFAULT_MUSIC_MODEL;
}

export function hasMusicProvider(id: string): boolean {
  return providers.has(id);
}

export async function resolveMusicKey(provider: MusicProvider): Promise<string | undefined> {
  return await musicCredentials().revealGatewayStoredApiKey(provider.id) ?? provider.environmentKey();
}

export async function configuredMusicModel() {
  const ref = selectedMusicModel();
  const route = resolveMusicModel(ref);
  if (!route || !await resolveMusicKey(route.provider)) return undefined;
  return { ...route, ref, defaults: getMusicDefaults(ref, route.capabilities.modes) };
}

export async function readMusicModelSettings(): Promise<MusicModelSettings> {
  const models = [...providers.values()].flatMap(provider => Object.entries(provider.models).map(([name, definition]) => ({
    ref: `${provider.id}/${name}`, name, providerId: provider.id, modes: definition.modes,
  })));
  const credentials = Object.fromEntries(await Promise.all([...providers.values()].map(async provider => {
    const saved = await musicCredentials().revealGatewayStoredApiKey(provider.id);
    return [provider.id, saved ? 'saved' : provider.environmentKey() ? 'environment' : 'missing'] as const;
  })));
  const modelRef = selectedMusicModel();
  const selected = models.find(model => model.ref === modelRef);
  return { modelRef, models, credentials, defaults: getMusicDefaults(modelRef, selected?.modes ?? []) };
}
