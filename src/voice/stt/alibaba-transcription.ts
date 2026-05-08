/**
 * Alibaba DashScope Paraformer STT — implements MediaUnderstandingProvider.transcribeAudio.
 *
 * DashScope's async API is a 4-step dance:
 *   1. POST /api/v1/services/audio/asr/transcription with `X-DashScope-Async: enable`
 *      and `input.file_urls = [data:audio/ogg;base64,...]` → returns task_id
 *   2. Poll GET /api/v1/tasks/{task_id} until task_status === 'SUCCEEDED'
 *   3. The success result contains `transcription_url` pointing at a JSON document
 *   4. Fetch that JSON to extract the actual `transcripts[].text`
 *
 * All HTTP calls go through `fetchWithTimeoutGuarded` so the SSRF guard catches
 * malicious config injection. The transcription_url is a public OSS URL
 * (CDN-hosted); we keep `allowPrivateNetwork: false` so a malicious tenant
 * cannot redirect to an internal address.
 *
 * Polling caps at 60s by default (60 * 1s). The runner's `timeoutMs` controls
 * HTTP timeouts on each individual submit/poll/fetch call, not the overall
 * poll loop ceiling.
 */

import {
  ProviderHttpError,
  fetchWithTimeoutGuarded,
  postJsonRequest,
} from '../../media-shared/http/index.js';
import { createLogger } from '../../utils/logger.js';
import { registerMediaUnderstandingProvider } from '../../media-understanding/registry.js';
import type {
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
  MediaUnderstandingProvider,
} from '../../media-understanding/types.js';

const log = createLogger('STT:Alibaba');

const DEFAULT_MODEL = 'paraformer-v2';
const DEFAULT_BASE_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';
const TASKS_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1/tasks';
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_MS = 60_000;

interface TaskResponse {
  status_code?: number;
  request_id?: string;
  code?: string;
  message?: string;
  output?: {
    task_id: string;
    task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  };
}

interface TranscriptionResultEntry {
  file_url: string;
  transcription_url: string;
  subtask_status: string;
}

interface FetchResponse {
  status_code?: number;
  request_id?: string;
  output?: {
    task_id: string;
    task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
    results?: TranscriptionResultEntry[];
  };
  usage?: { duration?: number };
}

interface TranscriptionDetail {
  file_url: string;
  properties: {
    audio_format: string;
    channels: number[];
    original_sampling_rate: number;
    original_duration_in_milliseconds: number;
  };
  transcripts: Array<{
    channel_id: number;
    content_duration_in_milliseconds: number;
    text: string;
  }>;
}

async function submitTask(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  audioDataUrl: string;
  language?: string;
  timeoutMs: number;
}): Promise<string> {
  const response = await postJsonRequest(params.baseUrl, {
    timeoutMs: params.timeoutMs,
    label: 'Alibaba STT submit',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: {
      model: params.model,
      input: { file_urls: [params.audioDataUrl] },
      ...(params.language ? { parameters: { language_hint: params.language } } : {}),
    },
  });
  const data = (await response.json()) as TaskResponse;
  if (data.code) {
    throw new Error(`Alibaba STT API error: ${data.code} - ${data.message}`);
  }
  if (!data.output?.task_id) {
    log.error({ response: data }, 'Alibaba STT API response missing task_id');
    throw new Error(`No task_id returned from Alibaba STT API: ${JSON.stringify(data)}`);
  }
  log.debug({ taskId: data.output.task_id }, 'Task submitted');
  return data.output.task_id;
}

async function pollTask(params: {
  apiKey: string;
  taskId: string;
  timeoutMs: number;
}): Promise<{ text: string }> {
  const startTime = Date.now();
  const url = `${TASKS_BASE_URL}/${params.taskId}`;
  while (Date.now() - startTime < MAX_POLL_MS) {
    const response = await fetchWithTimeoutGuarded(url, {
      timeoutMs: params.timeoutMs,
      label: 'Alibaba STT poll',
      init: {
        method: 'GET',
        headers: { Authorization: `Bearer ${params.apiKey}` },
      },
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new ProviderHttpError({
        label: 'Alibaba STT poll',
        status: response.status,
        detail: errorText.slice(0, 220) || response.statusText,
      });
    }
    const data = (await response.json()) as FetchResponse;
    const status = data.output?.task_status;
    if (status === 'SUCCEEDED') {
      const result = data.output?.results?.[0];
      if (!result) {
        throw new Error('Alibaba STT task succeeded but no results found');
      }
      const transcription = await fetchTranscription(result.transcription_url, params.timeoutMs);
      const fullText = transcription.transcripts.map((t) => t.text).join('\n');
      return { text: fullText };
    }
    if (status === 'FAILED') {
      throw new Error('Alibaba STT task failed');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Alibaba STT task did not complete within ${MAX_POLL_MS}ms`);
}

async function fetchTranscription(url: string, timeoutMs: number): Promise<TranscriptionDetail> {
  const response = await fetchWithTimeoutGuarded(url, {
    timeoutMs,
    label: 'Alibaba STT transcription fetch',
  });
  if (!response.ok) {
    throw new ProviderHttpError({
      label: 'Alibaba STT transcription fetch',
      status: response.status,
      detail: response.statusText,
    });
  }
  return (await response.json()) as TranscriptionDetail;
}

async function transcribeAudio(req: AudioTranscriptionRequest): Promise<AudioTranscriptionResult> {
  const startTime = Date.now();
  const model = req.model ?? DEFAULT_MODEL;
  const baseUrl = req.baseUrl ?? DEFAULT_BASE_URL;

  // Paraformer accepts `data:` URLs directly so we don't need to upload
  // the audio first. This avoids the OSS pre-signing dance.
  const base64Audio = req.buffer.toString('base64');
  const audioDataUrl = `data:${req.mime ?? 'audio/ogg'};base64,${base64Audio}`;

  log.debug(
    { model, bufferSize: req.buffer.length, language: req.language, fileName: req.fileName },
    'Sending to Alibaba Paraformer',
  );

  try {
    const taskId = await submitTask({
      apiKey: req.apiKey,
      baseUrl,
      model,
      audioDataUrl,
      ...(req.language ? { language: req.language } : {}),
      timeoutMs: req.timeoutMs,
    });
    const result = await pollTask({
      apiKey: req.apiKey,
      taskId,
      timeoutMs: req.timeoutMs,
    });
    const durationSeconds = (Date.now() - startTime) / 1000;
    log.info(
      { provider: 'alibaba', durationSeconds, textLength: result.text.length },
      'Transcription completed',
    );
    return {
      text: result.text,
      model,
      ...(req.language ? { language: req.language } : {}),
      durationSeconds,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(
      { err: error, bufferSize: req.buffer.length, model },
      `Alibaba transcription failed: ${errorMsg}`,
    );
    throw new Error(`Alibaba STT failed: ${errorMsg}`);
  }
}

export const alibabaTranscriptionProvider: MediaUnderstandingProvider = {
  id: 'alibaba',
  aliases: ['dashscope', 'paraformer'],
  capabilities: ['audio'],
  defaultModels: { audio: DEFAULT_MODEL },
  // Higher priority than openai for audio because Paraformer-v2 has better
  // Chinese accuracy and is the project's typical primary STT.
  autoPriority: { audio: 10 },
  transcribeAudio,
};

registerMediaUnderstandingProvider(alibabaTranscriptionProvider);
