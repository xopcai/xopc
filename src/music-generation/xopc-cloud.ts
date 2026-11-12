import { CLOUD_MEDIA_PROVIDER, CloudMediaError, queryCloudMedia, submitCloudMedia } from '../providers/xopc-cloud-media.js';
import { murekaProvider, murekaGlobalProvider } from './mureka.js';
import { MusicRequestRejected, type MusicProvider } from './provider.js';
import { tencentMpsProvider } from './tencent-mps.js';

const upstream = {
  music: murekaProvider.models['mureka-9.5'],
  'music-mureka-global': { ...murekaGlobalProvider.models['mureka-9.5'], name: 'mureka-9.5 (Global)' },
  'music-minimax': tencentMpsProvider.models['minimax-music-3.0'],
};

export const cloudMusicProvider: MusicProvider = {
  id: CLOUD_MEDIA_PROVIDER,
  name: 'XOPC Cloud',
  models: upstream,
  environmentKey: () => undefined,
  allowsAudioHost: host => murekaProvider.allowsAudioHost(host) || tencentMpsProvider.allowsAudioHost(host),
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
