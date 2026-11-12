import { VIDEO_MODELS, LOCAL_VIDEO_MODEL_REFS, VIDEO_MODEL_REFS, type VideoModelRef, type VideoModelDefinition } from '@xopcai/gateway-contract';

import { CLOUD_MEDIA_PROVIDER, CloudMediaError, getCloudMediaModels, queryCloudMedia, resolveCloudMediaToken, submitCloudMedia } from '../providers/xopc-cloud-media.js';
import { assertSafeUrl } from '../media-shared/http/ssrf-guard.js';
import { VideoProviderError, safeVideoErrorCode, type VideoProviderInput, type VideoProviderStatus } from './provider-types.js';
import { querySeedanceVideo, resolveSeedanceKey, submitSeedanceVideo } from './seedance.js';
import { queryWanVideo, resolveWanKey, submitWanVideo } from './wan.js';

type ProviderId = VideoModelDefinition['provider'];
interface VideoProvider {
  name: string;
  taskTtlMs: number;
  resolveKey: () => Promise<string | undefined>;
  submit: (key: string, job: VideoProviderInput) => Promise<string>;
  query: (key: string, taskId: string) => Promise<VideoProviderStatus>;
  downloadHost: RegExp;
}

const dayMs = 24 * 60 * 60 * 1000;
const providers: Record<ProviderId, VideoProvider> = {
  'dashscope-cn': {
    name: 'Bailian', taskTtlMs: dayMs, resolveKey: resolveWanKey, submit: submitWanVideo,
    downloadHost: /(^|\.)aliyuncs\.com$/i,
    async query(key, taskId) {
      const result = await queryWanVideo(key, taskId);
      switch (result.task_status) {
        case 'PENDING': return { state: 'submitted' };
        case 'RUNNING': return { state: 'running' };
        case 'SUCCEEDED':
          if (typeof result.video_url === 'string' && result.video_url) return { state: 'completed', url: result.video_url };
          break;
        case 'FAILED':
        case 'CANCELED':
        case 'UNKNOWN':
          return { state: 'failed', reason: `Bailian task ${result.task_status.toLowerCase()}${safeVideoErrorCode(result.code)}.` };
      }
      throw new Error('Bailian returned an incomplete or unrecognized task state');
    },
  },
  'volcengine-ark': {
    name: 'Volcengine Ark', taskTtlMs: 7 * dayMs, resolveKey: resolveSeedanceKey,
    submit: submitSeedanceVideo, query: querySeedanceVideo,
    downloadHost: /^[a-z0-9.-]+\.tos-cn-[a-z0-9-]+\.volces\.com$/i,
  },
  [CLOUD_MEDIA_PROVIDER]: {
    name: 'XOPC Cloud', taskTtlMs: 7 * dayMs, resolveKey: resolveCloudMediaToken,
    downloadHost: /(?:^|\.)aliyuncs\.com$|^[a-z0-9.-]+\.tos-cn-[a-z0-9-]+\.volces\.com$/i,
    async submit(token, job) {
      try {
        return await submitCloudMedia('videos', token, {
          model: job.model_ref.split('/')[1], prompt: job.prompt, duration: job.duration,
          ratio: job.ratio, resolution: job.resolution,
          ...(job.image_bytes ? { image: `data:${job.image_mime};base64,${Buffer.from(job.image_bytes).toString('base64')}` } : {}),
        });
      } catch (error) {
        if (error instanceof CloudMediaError) throw new VideoProviderError('XOPC Cloud', error.status);
        throw error;
      }
    },
    query: (token, task) => queryCloudMedia('videos', token, task),
  },
};

export function getVideoProvider(ref: VideoModelRef): VideoProvider {
  return providers[VIDEO_MODELS[ref].provider];
}

export function getAvailableVideoModelRefs(): VideoModelRef[] {
  const published = getCloudMediaModels('video');
  return [...LOCAL_VIDEO_MODEL_REFS, ...VIDEO_MODEL_REFS.filter(ref => published.some(model => `${CLOUD_MEDIA_PROVIDER}/${model.id}` === ref))];
}

export async function getConfiguredVideoProviders(): Promise<Record<ProviderId, boolean>> {
  const [wan, seedance, cloud] = await Promise.all([resolveWanKey(), resolveSeedanceKey(), resolveCloudMediaToken()]
    .map(key => key.catch(() => undefined)));
  return { 'dashscope-cn': Boolean(wan), 'volcengine-ark': Boolean(seedance), [CLOUD_MEDIA_PROVIDER]: Boolean(cloud) };
}

export async function fetchProviderVideo(provider: VideoProvider, url: string): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port
    || !provider.downloadHost.test(parsed.hostname)) {
    throw new Error(`${provider.name} returned an invalid video download host`);
  }
  await assertSafeUrl(parsed);
  const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Video download returned HTTP ${response.status}`);
  }
  return response;
}
