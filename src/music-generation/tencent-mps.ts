import { createHash, createHmac } from 'node:crypto';

import { TENCENT_MPS_MUSIC_PROVIDER } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { MusicRequestRejected, type MusicProvider } from './provider.js';

const host = 'mps.tencentcloudapi.com';
const contentType = 'application/json; charset=utf-8';
const algorithm = 'TC3-HMAC-SHA256';
const signedHeaders = 'content-type;host;x-tc-action';
const actionSchema = z.object({
  Response: z.object({
    Error: z.object({ Code: z.string() }).optional(),
    TaskId: z.string().min(1).max(200).optional(),
    Status: z.string().optional(),
    AudioInfos: z.array(z.object({ Url: z.string().optional(), Duration: z.number().nullish() })).nullish(),
  }),
});
export const tencentMpsCredentialsSchema = z.strictObject({
  secretId: z.string().trim().min(1).max(256).regex(/^[a-zA-Z0-9_-]+$/),
  secretKey: z.string().trim().min(1).max(256).regex(/^[a-zA-Z0-9_+/=-]+$/),
});

export function parseTencentMpsCredentials(stored: string | null) {
  if (!stored) return undefined;
  try {
    return tencentMpsCredentialsSchema.safeParse(JSON.parse(stored)).data;
  } catch {
    return undefined;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

async function callMps(key: string, action: 'CreateAigcAudioTask' | 'DescribeAigcAudioTask', input: object) {
  const credentials = parseTencentMpsCredentials(key);
  if (!credentials) throw new MusicRequestRejected('Tencent Cloud MPS credentials are invalid.', 'provider_rejected');

  const body = JSON.stringify(input);
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const scope = `${date}/mps/tc3_request`;
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(body)].join('\n');
  const toSign = [algorithm, timestamp, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(`TC3${credentials.secretKey}`, date), 'mps'), 'tc3_request');
  const signature = hmac(signingKey, toSign).toString('hex');
  const response = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      Authorization: `${algorithm} Credential=${credentials.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'Content-Type': contentType,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': '2019-06-12',
    },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(25_000),
  });
  const isSubmission = action === 'CreateAigcAudioTask';
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const message = `Tencent Cloud MPS returned HTTP ${response.status}.`;
    if (isSubmission && [400, 401, 402, 403, 404, 422, 429].includes(response.status)) {
      throw new MusicRequestRejected(message, response.status === 429 ? 'provider_rate_limited' : 'provider_rejected');
    }
    throw new Error(message);
  }
  const result = actionSchema.parse(await response.json()).Response;
  if (result.Error) {
    const code = result.Error.Code.split('.')[0];
    if (isSubmission && (code === 'RequestLimitExceeded' || code === 'LimitExceeded')) {
      throw new MusicRequestRejected(`Tencent Cloud MPS rejected the request (${code}).`, 'provider_rate_limited');
    }
    if (isSubmission && /^(AuthFailure|UnauthorizedOperation|InvalidParameter(?:Value)?|MissingParameter|UnsupportedOperation|OperationDenied|ResourceUnavailable|AccountError|NoSuchVersion|InvalidAction)$/.test(code)) {
      throw new MusicRequestRejected(`Tencent Cloud MPS rejected the request (${code}).`, 'provider_rejected');
    }
    throw new Error('Tencent Cloud MPS did not return a task result.');
  }
  return result;
}

export const tencentMpsProvider: MusicProvider = {
  id: TENCENT_MPS_MUSIC_PROVIDER,
  name: 'Tencent Cloud MPS',
  models: {
    'minimax-music-3.0': {
      name: 'MiniMax Music 3.0', modes: ['song', 'instrumental'], maxPromptCharacters: 2000, maxLyricsCharacters: 3500,
    },
  },
  environmentKey() {
    const credentials = tencentMpsCredentialsSchema.safeParse({
      secretId: process.env.TENCENTCLOUD_SECRET_ID,
      secretKey: process.env.TENCENTCLOUD_SECRET_KEY,
    });
    return credentials.success ? JSON.stringify(credentials.data) : undefined;
  },
  allowsAudioHost: hostname => hostname.endsWith('.myqcloud.com') || hostname.endsWith('.vod-qcloud.com'),
  async submit(key, _model, { mode, prompt, lyrics }) {
    const result = await callMps(key, 'CreateAigcAudioTask', {
      ModelName: 'MiniMaxMusic',
      ModelVersion: '3.0',
      SceneType: 'music',
      Prompt: prompt,
      ExtraParameters: { OutputAudioFormat: 'mp3' },
      AdditionalParameters: JSON.stringify(mode === 'song' ? { lyrics } : { is_instrumental: true }),
    });
    if (!result.TaskId) throw new Error('Tencent Cloud MPS did not return a task ID.');
    return result.TaskId;
  },
  async query(key, _mode, taskId) {
    const result = await callMps(key, 'DescribeAigcAudioTask', { TaskId: taskId });
    switch (result.Status) {
      case 'WAIT': return { state: 'submitted' };
      case 'RUN': return { state: 'running' };
      case 'FAIL': return { state: 'failed', reason: 'Tencent Cloud MPS reported that music generation failed.' };
      case 'DONE': {
        const audio = result.AudioInfos?.find(item => item.Url);
        if (!audio?.Url) break;
        const duration = audio.Duration;
        const durationMs = duration && duration > 0 ? Math.round(duration * 1000) : null;
        return { state: 'completed', url: audio.Url, durationMs };
      }
    }
    throw new Error('Tencent Cloud MPS returned an incomplete or unrecognized task status.');
  },
};
