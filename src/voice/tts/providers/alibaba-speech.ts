/**
 * Alibaba DashScope TTS provider (qwen-tts model).
 *
 * Implements the SpeechProviderPlugin contract directly because DashScope's
 * response shape (output.audio.url for the audio binary, no direct stream)
 * doesn't fit the OpenAI-compatible factory.
 *
 * Implementation notes (per docs/voice-rearchitecture.md §8.4.1):
 *   - `synthesizeStream` is intentionally not implemented. Native qwen-tts
 *     streaming uses a WebSocket protocol
 *     (wss://dashscope.aliyuncs.com/api-ws/v1/inference); speak-core's stream
 *     fallback wraps `synthesize` output as a single-chunk ReadableStream so
 *     callers see the same shape.
 *   - `maxTextLength = 512` (DashScope qwen-tts hard limit). Enforced upstream
 *     via `truncateAtSentenceBoundary` before this provider sees the text.
 *   - The audio URL returned by DashScope is hosted on Alibaba's CDN (variable
 *     hostname). We do not SSRF-guard the audio fetch because:
 *       (a) the URL is provided by the same provider we already trust for the
 *           initial synthesis call,
 *       (b) it's HTTPS-only and short-lived (~5 min TTL),
 *       (c) maintaining a hostname allowlist breaks every time Alibaba rotates
 *           CDN domains.
 *     A dedicated `assertSafeUrl` for trusted-CDN responses can be added later
 *     as a hardening pass.
 */

import {
  ProviderHttpError,
  fetchWithTimeoutGuarded,
  postJsonRequest,
} from '../../../media-shared/http/index.js';
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

const log = createLogger('SpeechProvider:Alibaba');

const DEFAULT_BASE_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const DEFAULT_MODEL = 'qwen-tts';
const DEFAULT_VOICE = 'longxiaochun';
const ENV_KEY = 'DASHSCOPE_API_KEY';
const MAX_TEXT_LENGTH = 512;
const ALIBABA_VOICES = [
  'Cherry',
  'Ethan',
  'Serena',
  'Chelsie',
  'longxiaochun',
  'longxiaobai',
  'longwan',
  'longcheng',
] as const;

interface AlibabaTtsConfig extends Record<string, unknown> {
  apiKey?: string;
  baseUrl: string;
  model: string;
  voice: string;
}

interface CosyVoiceResponse {
  output: {
    audio?: { url?: string; data?: string };
    speech?: string;
    speech_url?: string;
    finish_reason?: string;
  };
  usage?: { characters?: number };
  request_id?: string;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeConfig(rawConfig: Record<string, unknown>): AlibabaTtsConfig {
  const raw = asObject(rawConfig.alibaba) ?? rawConfig;
  return {
    apiKey: trimToUndefined(raw.apiKey),
    baseUrl: trimToUndefined(raw.baseUrl) ?? DEFAULT_BASE_URL,
    model: trimToUndefined(raw.model ?? raw.modelId) ?? DEFAULT_MODEL,
    voice: trimToUndefined(raw.voice ?? raw.voiceId) ?? DEFAULT_VOICE,
  };
}

function readProviderConfig(config: SpeechProviderConfig): AlibabaTtsConfig {
  return {
    apiKey: trimToUndefined(config.apiKey),
    baseUrl: trimToUndefined(config.baseUrl) ?? DEFAULT_BASE_URL,
    model: trimToUndefined(config.model ?? config.modelId) ?? DEFAULT_MODEL,
    voice: trimToUndefined(config.voice ?? config.voiceId) ?? DEFAULT_VOICE,
  };
}

function resolveApiKey(config: AlibabaTtsConfig): string | undefined {
  return config.apiKey ?? trimToUndefined(process.env[ENV_KEY]);
}

function parseDirectiveTokenInternal(
  ctx: SpeechDirectiveTokenParseContext,
): SpeechDirectiveTokenParseResult {
  switch (ctx.key) {
    case 'voice':
    case 'voice_id':
    case 'voiceid':
    case 'alibaba_voice':
    case 'alibabavoice':
      if (!ctx.policy.allowVoice) {
        return { handled: true };
      }
      return { handled: true, overrides: { voice: ctx.value } };
    case 'model':
    case 'model_id':
    case 'modelid':
    case 'alibaba_model':
    case 'alibabamodel':
      if (!ctx.policy.allowModelId) {
        return { handled: true };
      }
      return { handled: true, overrides: { model: ctx.value } };
    default:
      return { handled: false };
  }
}

export const alibabaSpeechProvider: SpeechProviderPlugin = {
  id: 'alibaba',
  aliases: ['dashscope', 'qwen-tts'],
  autoSelectOrder: 25,

  resolveConfig: (ctx: SpeechProviderResolveConfigContext) => normalizeConfig(ctx.rawConfig),

  isConfigured: (ctx: SpeechProviderConfiguredContext) =>
    Boolean(resolveApiKey(readProviderConfig(ctx.providerConfig))),

  parseDirectiveToken: parseDirectiveTokenInternal,

  listVoices: async () => ALIBABA_VOICES.map((id) => ({ id, name: id })),

  synthesize: async (req: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> => {
    const config = readProviderConfig(req.providerConfig);
    const apiKey = resolveApiKey(config);
    if (!apiKey) {
      throw new Error(
        `Alibaba TTS API key missing (set ${ENV_KEY} or messages.tts.providers.alibaba.apiKey)`,
      );
    }
    if (req.text.length > MAX_TEXT_LENGTH) {
      throw new Error(
        `Alibaba TTS text exceeds ${MAX_TEXT_LENGTH} char limit (got ${req.text.length})`,
      );
    }

    const overrides = req.providerOverrides ?? {};
    const model = trimToUndefined(overrides.model ?? overrides.modelId) ?? config.model;
    const voice = trimToUndefined(overrides.voice ?? overrides.voiceId) ?? config.voice;

    log.debug({ model, voice, textLength: req.text.length }, 'Calling Alibaba TTS');

    const response = await postJsonRequest(config.baseUrl, {
      timeoutMs: req.timeoutMs,
      label: 'Alibaba TTS',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-DashScope-DataInspection': 'disable',
      },
      body: {
        model,
        input: { text: req.text },
        parameters: { voice },
      },
    });

    const data = (await response.json()) as CosyVoiceResponse;

    // DashScope occasionally returns `finish_reason: "null"` (string) on failure.
    if (data.output?.finish_reason === 'null' && !data.output?.audio?.url) {
      throw new Error(`Alibaba TTS API error: ${JSON.stringify(data)}`);
    }

    let audioBuffer: Buffer;
    const audioUrl = data.output?.audio?.url ?? data.output?.speech_url;
    if (audioUrl) {
      // CDN URL — see file-level DECISION on why we skip SSRF here.
      const audioResponse = await fetchWithTimeoutGuarded(audioUrl, {
        timeoutMs: req.timeoutMs,
        label: 'Alibaba TTS audio download',
        allowPrivateNetwork: false,
      });
      if (!audioResponse.ok) {
        throw new ProviderHttpError({
          label: 'Alibaba TTS audio download',
          status: audioResponse.status,
          detail: audioResponse.statusText,
        });
      }
      audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    } else if (data.output?.speech) {
      audioBuffer = Buffer.from(data.output.speech, 'base64');
    } else if (data.output?.audio?.data) {
      audioBuffer = Buffer.from(data.output.audio.data, 'base64');
    } else {
      throw new Error('No audio returned from Alibaba TTS');
    }

    log.debug(
      { size: audioBuffer.length, characters: data.usage?.characters, requestId: data.request_id },
      'Alibaba TTS completed',
    );

    return {
      audioBuffer,
      outputFormat: 'wav',
      fileExtension: 'wav',
      // wav is NOT a Telegram voice-note format → ffmpeg compresses downstream.
      voiceCompatible: false,
    };
  },

  // synthesizeStream intentionally omitted — see file-level DECISION.
};

registerSpeechProvider(alibabaSpeechProvider);
