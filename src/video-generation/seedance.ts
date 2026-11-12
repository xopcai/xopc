import { getApiKey } from '../providers/index.js';
import { VideoProviderError, safeVideoErrorCode, type VideoProviderInput, type VideoProviderStatus } from './provider-types.js';

const ARK_TASKS = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';

export async function resolveSeedanceKey(): Promise<string | undefined> {
  const key = await getApiKey('volcengine-ark');
  return key && key !== 'extension-managed' ? key : undefined;
}

interface ArkResponse {
  id?: string;
  status?: string;
  updated_at?: number;
  content?: { video_url?: string };
  error?: { code?: string };
}

async function requestArk(key: string, taskId?: string, body?: object): Promise<ArkResponse> {
  const response = await fetch(taskId ? `${ARK_TASKS}/${encodeURIComponent(taskId)}` : ARK_TASKS, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body && JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => undefined) as ArkResponse | undefined;
  if (!response.ok) throw new VideoProviderError('Volcengine Ark', response.status, result?.error?.code);
  if (!result || typeof result !== 'object') throw new Error('Ark did not return a task result');
  return result;
}

export async function submitSeedanceVideo(key: string, job: VideoProviderInput): Promise<string> {
  const result = await requestArk(key, undefined, {
    model: job.model_ref.split('/')[1],
    content: [
      { type: 'text', text: job.prompt },
      ...(job.image_bytes ? [{
        type: 'image_url', role: 'first_frame',
        image_url: { url: `data:${job.image_mime};base64,${Buffer.from(job.image_bytes).toString('base64')}` },
      }] : []),
    ],
    ratio: job.ratio, duration: job.duration, resolution: job.resolution.toLowerCase(),
    generate_audio: false, watermark: true,
  });
  if (typeof result.id !== 'string' || !/^[\w-]{1,128}$/.test(result.id)) {
    throw new Error('Ark did not return a valid task ID');
  }
  return result.id;
}

export async function querySeedanceVideo(key: string, taskId: string): Promise<VideoProviderStatus> {
  const result = await requestArk(key, taskId);
  switch (result.status) {
    case 'queued': return { state: 'submitted' };
    case 'running': return { state: 'running' };
    case 'succeeded':
      if (typeof result.content?.video_url === 'string' && result.content.video_url) {
        const updatedAt = result.updated_at;
        const expiresAt = typeof updatedAt === 'number' && Number.isFinite(updatedAt) && updatedAt > 0
          ? (updatedAt + 86_400) * 1_000 : undefined;
        return { state: 'completed', url: result.content.video_url, ...(expiresAt ? { expiresAt } : {}) };
      }
      break;
    case 'failed':
    case 'cancelled':
    case 'expired':
      return { state: 'failed', reason: `Volcengine Ark task ${result.status}${safeVideoErrorCode(result.error?.code)}.` };
  }
  throw new Error('Ark returned an incomplete or unrecognized task state');
}
