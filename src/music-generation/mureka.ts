import { z } from 'zod';

import { MusicRequestRejected, type MusicProvider } from './provider.js';

const task = z.object({ id: z.string().min(1).max(200) });
const status = z.object({
  status: z.string(),
  choices: z.array(z.object({ url: z.string().optional(), duration: z.unknown().optional() })).optional(),
});

async function request(apiOrigin: string, key: string, path: string, input?: object): Promise<unknown> {
  const response = await fetch(new URL(path, apiOrigin), {
    method: input ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
    body: input ? JSON.stringify(input) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const message = `Mureka returned HTTP ${response.status}.`;
    if (input && [400, 401, 402, 403, 404, 422, 429].includes(response.status)) {
      throw new MusicRequestRejected(message);
    }
    throw new Error(message);
  }
  return response.json();
}

function createMurekaProvider(id: string, apiOrigin: string): MusicProvider {
  return {
    id,
    name: 'Mureka',
    models: { 'mureka-9.5': { modes: ['song', 'instrumental'], maxPromptCharacters: 1024, maxLyricsCharacters: 5000 } },
    environmentKey: () => {
      const regional = id === 'mureka-cn' ? process.env.MUREKA_CN_API_KEY : process.env.MUREKA_GLOBAL_API_KEY;
      return regional?.trim() || process.env.MUREKA_API_KEY?.trim() || undefined;
    },
    allowsAudioHost: host => host === 'cdn.mureka.cn' || host === 'cdn.mureka.ai'
      || (process.env.XOPC_MUREKA_AUDIO_HOSTS ?? '').split(',').some(value => value.trim().toLowerCase() === host),
    async submit(key, model, { mode, prompt, lyrics }) {
      const kind = mode === 'song' ? 'song' : 'instrumental';
      const result = await request(apiOrigin, key, `/v1/${kind}/generate`, {
        model, n: 1, prompt, ...(mode === 'song' ? { lyrics } : {}),
      });
      return task.parse(result).id;
    },
    async query(key, mode, taskId) {
      const kind = mode === 'song' ? 'song' : 'instrumental';
      const result = status.parse(await request(apiOrigin, key, `/v1/${kind}/query/${encodeURIComponent(taskId)}`));
      switch (result.status) {
        case 'preparing':
        case 'queued': return { state: 'submitted' };
        case 'running':
        case 'streaming': return { state: 'running' };
        case 'failed':
        case 'timeouted':
        case 'cancelled': return { state: 'failed', reason: `Mureka task ended with status ${result.status}.` };
        case 'succeeded': {
          const choice = result.choices?.[0];
          if (choice?.url) {
            const duration = choice.duration;
            const durationMs = typeof duration === 'number' && Number.isSafeInteger(duration) && duration > 0 ? duration : null;
            return { state: 'completed', url: choice.url, durationMs };
          }
          break;
        }
      }
      throw new Error('Mureka returned an incomplete or unrecognized music task status.');
    },
  };
}

export const murekaProvider = createMurekaProvider('mureka-cn', 'https://api.mureka.cn');
export const murekaGlobalProvider = createMurekaProvider('mureka-global', 'https://api.mureka.ai');
