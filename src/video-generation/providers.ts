import { VIDEO_MODELS, type VideoModelRef, type VideoModelDefinition } from '@xopcai/gateway-contract';

import { assertSafeUrl } from '../media-shared/http/ssrf-guard.js';
import { safeVideoErrorCode, type VideoProviderInput, type VideoProviderStatus } from './provider-types.js';
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
};

export function getVideoProvider(ref: VideoModelRef): VideoProvider {
  return providers[VIDEO_MODELS[ref].provider];
}

export async function getConfiguredVideoProviders(): Promise<Record<ProviderId, boolean>> {
  const [wan, seedance] = await Promise.all([resolveWanKey().catch(() => undefined), resolveSeedanceKey().catch(() => undefined)]);
  return { 'dashscope-cn': Boolean(wan), 'volcengine-ark': Boolean(seedance) };
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
