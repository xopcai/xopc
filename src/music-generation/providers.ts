import { TENCENT_MPS_MUSIC_PROVIDER, type MusicModelSettings } from '@xopcai/gateway-contract';

import { CLOUD_MEDIA_PROVIDER, getCloudMediaDefault, getCloudMediaModels, resolveCloudMediaToken } from '../providers/xopc-cloud-media.js';
import { murekaGlobalProvider, murekaProvider } from './mureka.js';
import type { MusicProvider } from './provider.js';
import { getMusicDefaults, musicCredentials, storedMusicModel } from './settings.js';
import { parseTencentMpsCredentials, tencentMpsProvider } from './tencent-mps.js';
import { cloudMusicProvider } from './xopc-cloud.js';

const providers = new Map<string, MusicProvider>([murekaProvider, murekaGlobalProvider, tencentMpsProvider, cloudMusicProvider].map(provider => [provider.id, provider]));
export const DEFAULT_MUSIC_MODEL = 'mureka-cn/mureka-9.5';

export function resolveMusicModel(ref: string) {
  const [providerId, model, extra] = ref.split('/');
  const provider = providers.get(providerId);
  if (!model || extra !== undefined || !provider || !Object.hasOwn(provider.models, model)) return undefined;
  return { provider, model, capabilities: provider.models[model] };
}

function selectedMusicModel(): string {
  const ref = storedMusicModel() ?? process.env.XOPC_MUSIC_MODEL?.trim();
  const cloud = getCloudMediaDefault('music');
  if (ref && resolveMusicModel(ref)) {
    if (cloud === 'xopc-cloud/music' && ref.startsWith('xopc-cloud/')
      && !getCloudMediaModels('music').some(item => `xopc-cloud/${item.id}` === ref)) return cloud;
    return ref;
  }
  return cloud && resolveMusicModel(cloud) ? cloud : DEFAULT_MUSIC_MODEL;
}

export function hasMusicProvider(id: string): boolean {
  return id !== CLOUD_MEDIA_PROVIDER && providers.has(id);
}

export async function resolveMusicKey(provider: MusicProvider): Promise<string | undefined> {
  if (provider.id === CLOUD_MEDIA_PROVIDER) return resolveCloudMediaToken();
  return await readSavedMusicKey(provider.id) ?? provider.environmentKey();
}

async function readSavedMusicKey(providerId: string): Promise<string | null> {
  const saved = await musicCredentials().revealGatewayStoredApiKey(providerId);
  return providerId === TENCENT_MPS_MUSIC_PROVIDER && !parseTencentMpsCredentials(saved) ? null : saved;
}

export async function configuredMusicModel() {
  const ref = selectedMusicModel();
  const route = resolveMusicModel(ref);
  if (!route || (route.provider.id === CLOUD_MEDIA_PROVIDER && !getCloudMediaModels('music').some(model => model.id === route.model))
    || !await resolveMusicKey(route.provider)) return undefined;
  return { ...route, ref, defaults: getMusicDefaults(ref, route.capabilities.modes) };
}

export async function readMusicModelSettings(): Promise<MusicModelSettings> {
  const modelRef = selectedMusicModel();
  const published = getCloudMediaModels('music');
  const models = [...providers.values()].flatMap(provider => Object.entries(provider.models)
    .filter(([id]) => provider.id !== CLOUD_MEDIA_PROVIDER || modelRef === `${CLOUD_MEDIA_PROVIDER}/${id}`
      || published.some(model => model.id === id))
    .map(([name, definition]) => {
      const cloud = provider.id === CLOUD_MEDIA_PROVIDER ? published.find(model => model.id === name) : undefined;
      return {
        ref: `${provider.id}/${name}`, name: cloud?.name ?? definition.name ?? name, providerId: provider.id, modes: definition.modes,
        ...(cloud?.prices.track ? { creditMicroPerTrack: cloud.prices.track } : {}),
      };
    }));
  const credentials = Object.fromEntries(await Promise.all([...providers.values()].map(async provider => {
    if (provider.id === CLOUD_MEDIA_PROVIDER) {
      return [provider.id, published.length > 0 && await resolveCloudMediaToken().catch(() => undefined) ? 'oauth' : 'missing'] as const;
    }
    const saved = await readSavedMusicKey(provider.id);
    return [provider.id, saved ? 'saved' : provider.environmentKey() ? 'environment' : 'missing'] as const;
  })));
  const selected = models.find(model => model.ref === modelRef);
  return { modelRef, models, credentials, defaults: getMusicDefaults(modelRef, selected?.modes ?? []) };
}
