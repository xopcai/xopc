import { BaseTTSProvider, type BaseProviderConfig } from './base.js';
import type { TTSOptions, TTSResult } from '../types.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('TTS:MiniMax');

const MINIMAX_API_BASE = 'https://api.minimaxi.com/v1';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60;

export const MINIMAX_TTS_MODELS = [
  'speech-2.8-hd',
  'speech-2.8-turbo',
  'speech-2.6-hd',
  'speech-2.6-turbo',
  'speech-02-hd',
  'speech-02-turbo',
] as const;

export const MINIMAX_TTS_VOICES = [
  'male-qn-qingse',
  'male-qn-jingying',
  'male-qn-badao',
  'male-qn-daxuesheng',
  'female-shaonv',
  'female-yujie',
  'female-chengshu',
  'female-tianmei',
  'audiobook_male_1',
  'audiobook_male_2',
  'audiobook_female_1',
  'audiobook_female_2',
  'presenter_male',
  'presenter_female',
] as const;

export interface MinimaxProviderConfig extends BaseProviderConfig {
  apiKey: string;
  model?: string;
  voice?: string;
}

type MiniMaxBaseResp = {
  status_code?: number;
  status_msg?: string;
};

type SubmitResponse = {
  task_id?: string;
  base_resp?: MiniMaxBaseResp;
};

type QueryResponse = {
  status?: string;
  file_id?: string;
  base_resp?: MiniMaxBaseResp;
};

function abortSleepError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

export class MinimaxProvider extends BaseTTSProvider {
  readonly name = 'minimax';

  private apiKey: string;
  private model: string;
  private voice: string;

  constructor(config: MinimaxProviderConfig) {
    super({
      ...config,
      timeoutMs: Math.max(config.timeoutMs ?? 30000, 150000),
    });
    this.apiKey = config.apiKey;
    this.model = config.model || 'speech-2.8-hd';
    this.voice = config.voice || 'male-qn-qingse';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  protected async doSpeak(text: string, options?: TTSOptions): Promise<TTSResult> {
    const model = options?.model || this.model;
    const voice = options?.voice || this.voice;
    const signal = this.signal;

    log.debug({ model, voice, textLength: text.length }, 'MiniMax TTS submit');

    const taskId = await this._submitTask(text, model, voice, signal);
    const fileId = await this._pollTaskCompletion(taskId, signal);
    const audioBuffer = await this._downloadAudio(fileId, signal);

    log.debug({ size: audioBuffer.length, taskId }, 'MiniMax TTS completed');

    return {
      audio: audioBuffer,
      format: 'mp3',
      provider: this.name,
    };
  }

  private async _submitTask(
    text: string,
    model: string,
    voiceId: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const res = await fetch(`${MINIMAX_API_BASE}/t2a_async_v2`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        text,
        voice_setting: {
          voice_id: voiceId,
          speed: 1,
          vol: 10,
          pitch: 0,
        },
        audio_setting: {
          audio_sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
      }),
      signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`MiniMax TTS submit failed (${res.status}): ${raw || res.statusText}`);
    }

    let data: SubmitResponse;
    try {
      data = JSON.parse(raw) as SubmitResponse;
    } catch {
      throw new Error(`MiniMax TTS submit returned non-JSON: ${raw.slice(0, 240)}`);
    }

    const code = data.base_resp?.status_code;
    if (code !== undefined && code !== 0) {
      throw new Error(
        `MiniMax TTS submit error: ${code} ${data.base_resp?.status_msg ?? ''}`.trim(),
      );
    }

    const taskId = data.task_id?.trim();
    if (!taskId) {
      throw new Error('MiniMax TTS submit returned no task_id');
    }
    return taskId;
  }

  private async _pollTaskCompletion(taskId: string, signal: AbortSignal | undefined): Promise<string> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      if (signal?.aborted) {
        throw abortSleepError();
      }

      const url = `${MINIMAX_API_BASE}/query/t2a_async_query_v2?task_id=${encodeURIComponent(taskId)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal,
      });

      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`MiniMax TTS query failed (${res.status}): ${raw || res.statusText}`);
      }

      let data: QueryResponse;
      try {
        data = JSON.parse(raw) as QueryResponse;
      } catch {
        throw new Error(`MiniMax TTS query returned non-JSON: ${raw.slice(0, 240)}`);
      }

      const code = data.base_resp?.status_code;
      if (code !== undefined && code !== 0) {
        throw new Error(
          `MiniMax TTS query error: ${code} ${data.base_resp?.status_msg ?? ''}`.trim(),
        );
      }

      const status = (data.status || '').trim();
      if (status === 'Success') {
        const fileId = data.file_id?.trim();
        if (!fileId) {
          throw new Error('MiniMax TTS completed but file_id is missing');
        }
        return fileId;
      }

      if (status === 'Failed' || status === 'Fail') {
        throw new Error('MiniMax TTS task failed');
      }

      await this._sleep(POLL_INTERVAL_MS, signal);
    }

    throw new Error(`MiniMax TTS timed out after ${MAX_POLL_ATTEMPTS} polls`);
  }

  private async _downloadAudio(fileId: string, signal: AbortSignal | undefined): Promise<Buffer> {
    const url = `${MINIMAX_API_BASE}/files/retrieve_content?file_id=${encodeURIComponent(fileId)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal,
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`MiniMax TTS download failed (${res.status}): ${t || res.statusText}`);
    }

    return Buffer.from(await res.arrayBuffer());
  }

  private _sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortSleepError());
        return;
      }
      const id = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(id);
        signal?.removeEventListener('abort', onAbort);
        reject(abortSleepError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
