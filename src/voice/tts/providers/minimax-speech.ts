/**
 * MiniMax TTS provider — async task model (submit → poll → download).
 *
 * MiniMax's t2a_async_v2 endpoint does not match the OpenAI POST /audio/speech
 * shape (it returns task_id, then we poll, then we fetch the file by file_id),
 * so we implement the contract directly rather than using
 * createOpenAiCompatibleSpeechProvider.
 *
 * Implementation notes (per docs/voice-rearchitecture.md §8.4.4):
 *   - Default per-call timeout: 150s. Submit + poll + download can legitimately
 *     take 60-120s on long inputs, so we enforce `Math.max(timeoutMs, 150000)`.
 *   - `synthesizeStream` is intentionally not implemented. MiniMax has a
 *     separate WebSocket streaming endpoint that does not match the
 *     buffer-then-wrap pattern; speak-core falls back to wrapBufferAsStream.
 *   - Poll interval = 2s, max 60 attempts (2 min cap). Aligns with MiniMax docs.
 *   - `groupId` is read from config but not passed into the request body —
 *     MiniMax embeds groupId in the API key for this account tier. Kept as a
 *     forward-compat slot for the enterprise account tier.
 */

import { ProviderHttpError, fetchWithTimeoutGuarded } from '../../../media-shared/http/index.js';
import { createLogger } from '../../../utils/logger.js';
import { registerSpeechProvider } from '../speech-registry.js';
import type {
  SpeechDirectiveTokenParseContext,
  SpeechDirectiveTokenParseResult,
  SpeechProviderConfig,
  SpeechProviderConfiguredContext,
  SpeechProviderPlugin,
  SpeechProviderResolveConfigContext,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from '../speech-provider-types.js';

const log = createLogger('SpeechProvider:MiniMax');

const DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1';
const DEFAULT_MODEL = 'speech-2.8-hd';
const DEFAULT_VOICE = 'male-qn-qingse';
const ENV_KEY = 'MINIMAX_API_KEY';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60;
const DEFAULT_TIMEOUT_MS = 150_000;

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

interface MinimaxTtsConfig extends Record<string, unknown> {
  apiKey?: string;
  baseUrl: string;
  model: string;
  voice: string;
  groupId?: string;
}

interface MiniMaxBaseResp {
  status_code?: number;
  status_msg?: string;
}

interface SubmitResponse {
  task_id?: string;
  base_resp?: MiniMaxBaseResp;
}

interface QueryResponse {
  status?: string;
  file_id?: string;
  base_resp?: MiniMaxBaseResp;
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeConfig(rawConfig: Record<string, unknown>): MinimaxTtsConfig {
  const raw = asObject(rawConfig.minimax) ?? rawConfig;
  return {
    apiKey: trimToUndefined(raw.apiKey),
    baseUrl: (trimToUndefined(raw.baseUrl) ?? DEFAULT_BASE_URL).replace(/\/+$/u, ''),
    model: trimToUndefined(raw.model ?? raw.modelId) ?? DEFAULT_MODEL,
    voice: trimToUndefined(raw.voice ?? raw.voiceId) ?? DEFAULT_VOICE,
    groupId: trimToUndefined(raw.groupId),
  };
}

function readProviderConfig(config: SpeechProviderConfig): MinimaxTtsConfig {
  return {
    apiKey: trimToUndefined(config.apiKey),
    baseUrl: (trimToUndefined(config.baseUrl) ?? DEFAULT_BASE_URL).replace(/\/+$/u, ''),
    model: trimToUndefined(config.model ?? config.modelId) ?? DEFAULT_MODEL,
    voice: trimToUndefined(config.voice ?? config.voiceId) ?? DEFAULT_VOICE,
    groupId: trimToUndefined(config.groupId),
  };
}

function resolveApiKey(config: MinimaxTtsConfig): string | undefined {
  return config.apiKey ?? trimToUndefined(process.env[ENV_KEY]);
}

function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function submitTask(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  voiceId: string;
  text: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await fetchWithTimeoutGuarded(`${params.baseUrl}/t2a_async_v2`, {
    timeoutMs: params.timeoutMs,
    label: 'MiniMax TTS submit',
    signal: params.signal,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        text: params.text,
        voice_setting: { voice_id: params.voiceId, speed: 1, vol: 10, pitch: 0 },
        audio_setting: {
          audio_sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
      }),
    },
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new ProviderHttpError({
      label: 'MiniMax TTS submit',
      status: response.status,
      detail: raw.slice(0, 220) || response.statusText,
    });
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

async function pollTask(params: {
  baseUrl: string;
  apiKey: string;
  taskId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<string> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (params.signal?.aborted) {
      throw abortError();
    }
    const url = `${params.baseUrl}/query/t2a_async_query_v2?task_id=${encodeURIComponent(params.taskId)}`;
    const response = await fetchWithTimeoutGuarded(url, {
      timeoutMs: params.timeoutMs,
      label: 'MiniMax TTS query',
      signal: params.signal,
      init: {
        method: 'GET',
        headers: { Authorization: `Bearer ${params.apiKey}` },
      },
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new ProviderHttpError({
        label: 'MiniMax TTS query',
        status: response.status,
        detail: raw.slice(0, 220) || response.statusText,
      });
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
    await sleep(POLL_INTERVAL_MS, params.signal);
  }
  throw new Error(`MiniMax TTS timed out after ${MAX_POLL_ATTEMPTS} polls`);
}

async function downloadAudio(params: {
  baseUrl: string;
  apiKey: string;
  fileId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const url = `${params.baseUrl}/files/retrieve_content?file_id=${encodeURIComponent(params.fileId)}`;
  const response = await fetchWithTimeoutGuarded(url, {
    timeoutMs: params.timeoutMs,
    label: 'MiniMax TTS download',
    signal: params.signal,
    init: {
      method: 'GET',
      headers: { Authorization: `Bearer ${params.apiKey}` },
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ProviderHttpError({
      label: 'MiniMax TTS download',
      status: response.status,
      detail: detail.slice(0, 220) || response.statusText,
    });
  }
  return Buffer.from(await response.arrayBuffer());
}

function parseDirectiveTokenInternal(
  ctx: SpeechDirectiveTokenParseContext,
): SpeechDirectiveTokenParseResult {
  switch (ctx.key) {
    case 'voice':
    case 'voice_id':
    case 'voiceid':
    case 'minimax_voice':
    case 'minimaxvoice':
      if (!ctx.policy.allowVoice) return { handled: true };
      return { handled: true, overrides: { voice: ctx.value } };
    case 'model':
    case 'model_id':
    case 'modelid':
    case 'minimax_model':
    case 'minimaxmodel':
      if (!ctx.policy.allowModelId) return { handled: true };
      return { handled: true, overrides: { model: ctx.value } };
    default:
      return { handled: false };
  }
}

export const minimaxSpeechProvider: SpeechProviderPlugin = {
  id: 'minimax',
  autoSelectOrder: 40,

  resolveConfig: (ctx: SpeechProviderResolveConfigContext) => normalizeConfig(ctx.rawConfig),

  isConfigured: (ctx: SpeechProviderConfiguredContext) =>
    Boolean(resolveApiKey(readProviderConfig(ctx.providerConfig))),

  parseDirectiveToken: parseDirectiveTokenInternal,

  listVoices: async () => MINIMAX_TTS_VOICES.map((id) => ({ id, name: id })),

  synthesize: async (req: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> => {
    const config = readProviderConfig(req.providerConfig);
    const apiKey = resolveApiKey(config);
    if (!apiKey) {
      throw new Error(
        `MiniMax TTS API key missing (set ${ENV_KEY} or messages.tts.providers.minimax.apiKey)`,
      );
    }
    const overrides = req.providerOverrides ?? {};
    const model = trimToUndefined(overrides.model ?? overrides.modelId) ?? config.model;
    const voice = trimToUndefined(overrides.voice ?? overrides.voiceId) ?? config.voice;
    const callTimeoutMs = Math.max(req.timeoutMs, DEFAULT_TIMEOUT_MS);

    log.debug({ model, voice, textLength: req.text.length }, 'MiniMax TTS submit');
    const taskId = await submitTask({
      baseUrl: config.baseUrl,
      apiKey,
      model,
      voiceId: voice,
      text: req.text,
      timeoutMs: callTimeoutMs,
      signal: req.signal,
    });
    const fileId = await pollTask({
      baseUrl: config.baseUrl,
      apiKey,
      taskId,
      timeoutMs: callTimeoutMs,
      signal: req.signal,
    });
    const audioBuffer = await downloadAudio({
      baseUrl: config.baseUrl,
      apiKey,
      fileId,
      timeoutMs: callTimeoutMs,
      signal: req.signal,
    });
    log.debug({ size: audioBuffer.length, taskId }, 'MiniMax TTS completed');
    return {
      audioBuffer,
      outputFormat: 'mp3',
      fileExtension: 'mp3',
      voiceCompatible: false, // mp3 → ffmpeg compresses to opus downstream
    };
  },

  // synthesizeStream intentionally omitted — see file-level DECISION.
};

registerSpeechProvider(minimaxSpeechProvider);
