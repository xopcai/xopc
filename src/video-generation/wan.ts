import { getApiKey } from '../providers/index.js';
import { VideoProviderError, type VideoProviderInput } from './provider-types.js';

interface WanResponse {
  output?: { task_id?: string; task_status?: string; video_url?: string; code?: string };
  code?: string;
}

export async function resolveWanKey(): Promise<string | undefined> {
  const key = await getApiKey('dashscope-cn');
  return key && key !== 'extension-managed' ? key : undefined;
}

function wanEndpoint(): string {
  const workspace = process.env.XOPC_WAN_WORKSPACE_ID?.trim();
  if (!workspace) return 'https://dashscope.aliyuncs.com';
  if (!/^[a-z0-9-]{1,63}$/i.test(workspace)) throw new Error('Invalid XOPC_WAN_WORKSPACE_ID');
  return `https://${workspace}.cn-beijing.maas.aliyuncs.com`;
}

async function requestWan(path: string, key: string, body?: object): Promise<WanResponse> {
  const response = await fetch(new URL(path, wanEndpoint()), {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' } : {}),
    },
    body: body && JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => undefined) as WanResponse | undefined;
  if (!response.ok || result?.code) throw new VideoProviderError('Bailian', response.status, result?.code);
  if (!result?.output) throw new Error('Bailian did not return a task result');
  return result;
}

export async function submitWanVideo(key: string, job: VideoProviderInput): Promise<string> {
  const result = await requestWan('/api/v1/services/aigc/video-generation/video-synthesis', key, {
    model: job.model_ref.split('/')[1],
    input: {
      prompt: job.prompt,
      ...(job.image_bytes ? { media: [{
        type: 'first_frame',
        url: `data:${job.image_mime};base64,${Buffer.from(job.image_bytes).toString('base64')}`,
      }] } : {}),
    },
    parameters: { duration: job.duration, ratio: job.ratio, resolution: job.resolution, audio: false, watermark: true },
  });
  const id = result.output?.task_id;
  if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) throw new Error('Bailian did not return a valid task ID');
  return id;
}

export async function queryWanVideo(key: string, id: string) {
  return (await requestWan(`/api/v1/tasks/${encodeURIComponent(id)}`, key)).output!;
}

