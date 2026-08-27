import { createInterface } from 'node:readline';
import { join, resolve, sep } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

import { EnvHttpProxyAgent, RetryAgent, setGlobalDispatcher } from 'undici';

import { getLocalVoiceModel, resolveLocalVoiceModelDir } from './models.js';
import { downloadLocalVoiceModelFiles } from './model-files.js';

type RuntimeRequest = { id: number; method: string; params?: Record<string, unknown> };
type AsrPipeline = (audio: Float32Array, options?: Record<string, unknown>) => Promise<unknown>;

const pipelines = new Map<string, Promise<AsrPipeline>>();

interface SherpaOfflineStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  setOption?(key: string, value: string): void;
}

interface SherpaResult {
  text?: string;
  lang?: string;
  emotion?: string;
  event?: string;
}

interface SherpaOfflineRecognizer {
  createStream(): SherpaOfflineStream;
  decodeAsync?(stream: SherpaOfflineStream): Promise<SherpaResult>;
  decode(stream: SherpaOfflineStream): void;
  getResult(stream: SherpaOfflineStream): SherpaResult;
}

type SherpaModule = {
  OfflineRecognizer: new (config: Record<string, unknown>) => SherpaOfflineRecognizer;
};

const sherpaRecognizers = new Map<string, Promise<SherpaOfflineRecognizer>>();

const networkAgent = new RetryAgent(new EnvHttpProxyAgent(), {
  maxRetries: 4,
  minTimeout: 500,
  maxTimeout: 8_000,
  timeoutFactor: 2,
  retryAfter: true,
});
setGlobalDispatcher(networkAgent);

function normalizeRemoteHost(value: string): string {
  const url = new URL(value);
  if (url.username || url.password) {
    throw new Error('Local voice model endpoint must not contain credentials');
  }
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('Local voice model endpoint must use HTTPS');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.toString();
}

function resolveRemoteHosts(): string[] {
  const configured = process.env.XOPC_VOICE_MODEL_ENDPOINT?.trim()
    || process.env.HF_ENDPOINT?.trim();
  if (configured) return [normalizeRemoteHost(configured)];
  return [
    normalizeRemoteHost('https://xopc.ai/api/voice/models'),
    normalizeRemoteHost('https://huggingface.co'),
  ];
}

function serializeError(error: unknown): { message: string; code?: string; cause?: string } {
  if (!(error instanceof Error)) return { message: String(error) };
  const withCode = error as Error & { code?: unknown; cause?: unknown };
  const nested = withCode.cause;
  const nestedMessage = nested instanceof Error ? nested.message : undefined;
  const nestedCode = nested && typeof nested === 'object' && 'code' in nested
    ? String((nested as { code?: unknown }).code ?? '')
    : undefined;
  return {
    message: error.message,
    ...(typeof withCode.code === 'string' ? { code: withCode.code } : {}),
    ...(nestedCode ? { code: nestedCode } : {}),
    ...(nestedMessage && nestedMessage !== error.message ? { cause: nestedMessage } : {}),
  };
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function loadPipeline(
  modelId: string,
  allowRemote: boolean,
  cacheDir = resolveLocalVoiceModelDir(modelId),
  onProgress?: (data: Record<string, unknown>) => void,
): Promise<AsrPipeline> {
  const key = `${modelId}:${cacheDir}`;
  const existing = pipelines.get(key);
  if (existing) return existing;
  const model = getLocalVoiceModel(modelId);
  if (model.engine !== 'transformers.js') {
    throw new Error(`Model ${model.id} does not use the Transformers.js engine`);
  }
  const promise = (async () => {
    let transformers: typeof import('@huggingface/transformers');
    try {
      transformers = await import('@huggingface/transformers');
    } catch (cause) {
      throw new Error(
        'The Transformers.js local voice engine is not installed. '
        + 'Install @huggingface/transformers@3.8.1 alongside @xopcai/xopc; '
        + 'use npm install -g when xopc is installed globally.',
        { cause },
      );
    }
    transformers.env.cacheDir = cacheDir;
    transformers.env.allowRemoteModels = allowRemote;
    transformers.env.allowLocalModels = true;
    const remoteHosts = allowRemote ? resolveRemoteHosts() : [normalizeRemoteHost('https://xopc.ai')];
    let lastError: unknown;
    for (const [index, remoteHost] of remoteHosts.entries()) {
      transformers.env.remoteHost = remoteHost;
      try {
        const result = await transformers.pipeline('automatic-speech-recognition', model.repository, {
          revision: model.revision,
          dtype: model.dtype,
          progress_callback: onProgress,
        });
        return result as unknown as AsrPipeline;
      } catch (error) {
        lastError = error;
        if (index + 1 < remoteHosts.length) {
          await rm(cacheDir, { recursive: true, force: true });
          await mkdir(cacheDir, { recursive: true });
        }
      }
    }
    throw lastError;
  })();
  pipelines.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    pipelines.delete(key);
    throw error;
  }
}

function normalizeSenseVoiceLanguage(language: unknown): string {
  if (typeof language !== 'string') return 'auto';
  const value = language.trim().toLowerCase().replace('_', '-');
  if (!value || value === 'auto') return 'auto';
  if (value === 'cmn' || value.startsWith('zh')) return 'zh';
  if (value === 'cantonese' || value.startsWith('yue')) return 'yue';
  if (value.startsWith('en')) return 'en';
  if (value.startsWith('ja')) return 'ja';
  if (value.startsWith('ko')) return 'ko';
  return 'auto';
}

function cleanSenseVoiceTag(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/^<\|/, '').replace(/\|>$/, '').trim();
  return cleaned || undefined;
}

async function loadSherpaRecognizer(
  modelId: string,
  language: string,
): Promise<SherpaOfflineRecognizer> {
  const key = `${modelId}:${language}`;
  const existing = sherpaRecognizers.get(key);
  if (existing) return existing;
  const model = getLocalVoiceModel(modelId);
  if (model.engine !== 'sherpa-onnx') {
    throw new Error(`Model ${model.id} does not use the sherpa-onnx engine`);
  }
  const modelDir = resolveLocalVoiceModelDir(model.id);
  const promise = (async () => {
    let imported: typeof import('sherpa-onnx-node');
    try {
      imported = await import('sherpa-onnx-node');
    } catch (cause) {
      throw new Error(
        'The sherpa-onnx local voice engine is not installed. '
        + 'Install sherpa-onnx-node@1.13.4 alongside @xopcai/xopc; '
        + 'use npm install -g when xopc is installed globally.',
        { cause },
      );
    }
    const sherpa = ((imported as { default?: SherpaModule }).default ?? imported) as SherpaModule;
    return new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: {
        senseVoice: {
          model: join(modelDir, 'model.int8.onnx'),
          language,
          useInverseTextNormalization: 1,
        },
        tokens: join(modelDir, 'tokens.txt'),
        numThreads: Math.max(1, Math.min(4, Number(process.env.XOPC_VOICE_THREADS) || 2)),
        provider: 'cpu',
        debug: 0,
      },
    });
  })();
  sherpaRecognizers.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    sherpaRecognizers.delete(key);
    throw error;
  }
}

async function transcribeWithSherpa(
  modelId: string,
  audio: Float32Array,
  language: unknown,
): Promise<{ text: string; language?: string; emotion?: string; event?: string }> {
  const recognizer = await loadSherpaRecognizer(modelId, normalizeSenseVoiceLanguage(language));
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: 16_000, samples: audio });
  const result = recognizer.decodeAsync
    ? await recognizer.decodeAsync(stream)
    : (recognizer.decode(stream), recognizer.getResult(stream));
  return {
    text: String(result.text ?? '').trim(),
    ...(cleanSenseVoiceTag(result.lang) ? { language: cleanSenseVoiceTag(result.lang) } : {}),
    ...(cleanSenseVoiceTag(result.emotion) ? { emotion: cleanSenseVoiceTag(result.emotion) } : {}),
    ...(cleanSenseVoiceTag(result.event) ? { event: cleanSenseVoiceTag(result.event) } : {}),
  };
}

async function handle(request: RuntimeRequest): Promise<unknown> {
  const params = request.params ?? {};
  if (request.method === 'health') {
    return {
      ok: true,
      protocolVersion: 2,
      engine: 'transformers.js+sherpa-onnx',
      engines: ['transformers.js', 'sherpa-onnx'],
    };
  }
  if (request.method === 'model.install') {
    const modelId = String(params.modelId ?? '');
    const modelDir = resolve(resolveLocalVoiceModelDir(modelId));
    const requestedCacheDir = typeof params.cacheDir === 'string' ? resolve(params.cacheDir) : modelDir;
    const allowedPrefix = `${resolve(modelDir, '..')}${sep}`;
    if (requestedCacheDir !== modelDir && !requestedCacheDir.startsWith(allowedPrefix)) {
      throw new Error('Local voice model cache directory is outside the managed root');
    }
    const model = getLocalVoiceModel(modelId);
    if (model.engine === 'sherpa-onnx') {
      await downloadLocalVoiceModelFiles({
        model,
        destinationDir: requestedCacheDir,
        remoteHosts: resolveRemoteHosts(),
        onProgress: (data) => send({ id: request.id, event: 'progress', data }),
      });
    } else {
      await loadPipeline(
        modelId,
        true,
        requestedCacheDir,
        (data) => send({ id: request.id, event: 'progress', data }),
      );
      pipelines.delete(`${modelId}:${requestedCacheDir}`);
    }
    return { installed: true, modelId };
  }
  if (request.method === 'model.unload') {
    const modelId = String(params.modelId ?? '');
    for (const key of pipelines.keys()) {
      if (key.startsWith(`${modelId}:`)) pipelines.delete(key);
    }
    for (const key of sherpaRecognizers.keys()) {
      if (key.startsWith(`${modelId}:`)) sherpaRecognizers.delete(key);
    }
    return { unloaded: true };
  }
  if (request.method === 'transcribe') {
    const modelId = String(params.modelId ?? '');
    const bytes = Buffer.from(String(params.audioBase64 ?? ''), 'base64');
    const copied = Uint8Array.from(bytes);
    const audio = new Float32Array(copied.buffer);
    const language = typeof params.language === 'string' && params.language ? params.language : undefined;
    const model = getLocalVoiceModel(modelId);
    if (model.engine === 'sherpa-onnx') {
      return { ...(await transcribeWithSherpa(model.id, audio, language)), modelId };
    }
    const pipeline = await loadPipeline(modelId, false);
    const output = await pipeline(audio, {
      task: 'transcribe',
      ...(language ? { language } : {}),
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });
    const text = output && typeof output === 'object' && 'text' in output
      ? String((output as { text?: unknown }).text ?? '')
      : '';
    return { text: text.trim(), modelId };
  }
  throw new Error(`Unknown local voice runtime method: ${request.method}`);
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let request: RuntimeRequest;
  try {
    request = JSON.parse(line) as RuntimeRequest;
  } catch {
    return;
  }
  void handle(request).then(
    (result) => send({ id: request.id, result }),
    (error: unknown) => send({ id: request.id, error: serializeError(error) }),
  );
});
lines.once('close', () => {
  void networkAgent.close().finally(() => process.exit(0));
});
