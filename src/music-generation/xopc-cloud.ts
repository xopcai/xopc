import { resolveXopcModelRouterUrl } from '../providers/xopc-cloud-config.js';
import { CLOUD_MEDIA_PROVIDER, CloudMediaError, queryCloudMedia, submitCloudMedia } from '../providers/xopc-cloud-media.js';
import { murekaProvider, murekaGlobalProvider } from './mureka.js';
import { MusicRequestRejected, type MusicProvider } from './provider.js';
import { tencentMpsProvider } from './tencent-mps.js';

const upstream = {
  music: murekaProvider.models['mureka-9.5'],
  'music-mureka-cn': { ...murekaProvider.models['mureka-9.5'], name: 'mureka-9.5 (China)' },
  'music-mureka-global': { ...murekaGlobalProvider.models['mureka-9.5'], name: 'mureka-9.5 (Global)' },
  'music-minimax': tencentMpsProvider.models['minimax-music-3.0'],
};

export const cloudMusicProvider: MusicProvider = {
  id: CLOUD_MEDIA_PROVIDER,
  name: 'XOPC Cloud',
  models: upstream,
  environmentKey: () => undefined,
  allowsAudioHost: host => murekaProvider.allowsAudioHost(host) || tencentMpsProvider.allowsAudioHost(host),
  async downloadAudio(token, url) {
    const router = new URL(resolveXopcModelRouterUrl());
    const prefix = `${router.pathname.replace(/\/$/, '')}/music/generations/`;
    const route = url.pathname.slice(prefix.length);
    if (url.origin === router.origin && url.pathname.startsWith(prefix)
      && /^[\da-f-]{36}\/audio$/i.test(route) && !url.search && !url.hash) {
      return fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(45_000),
        redirect: 'error',
      });
    }
    if (!cloudMusicProvider.allowsAudioHost(url.hostname)) throw new Error('Music provider returned an untrusted audio URL.');
    return fetch(url, { signal: AbortSignal.timeout(45_000), redirect: 'error' });
  },
  async submit(token, model, input) {
    try {
      return await submitCloudMedia('music', token, { model, ...input });
    } catch (error) {
      if (error instanceof CloudMediaError && error.status >= 400 && error.status < 500 && error.status !== 408) {
        throw new MusicRequestRejected(error.message, error.status === 429 ? 'provider_rate_limited' : 'provider_rejected');
      }
      throw error;
    }
  },
  async query(token, _mode, taskId) {
    const status = await queryCloudMedia('music', token, taskId);
    return status.state === 'completed' ? { ...status, durationMs: status.durationMs ?? null } : status;
  },
};
