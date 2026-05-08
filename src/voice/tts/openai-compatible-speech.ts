/**
 * Factory: createOpenAiCompatibleSpeechProvider
 *
 * Most TTS providers (OpenAI, MiniMax, ElevenLabs, OpenRouter, ...) speak the
 * OpenAI `/audio/speech` POST shape. This factory eliminates the boilerplate so
 * a new compatible vendor is ~30 lines of declaration instead of a full provider
 * implementation.
 *
 * Ported from openclaw/src/tts/openai-compatible-speech-provider.ts (commit
 * baseline 2026-05-08), with the following INTENTIONAL OMISSIONS per
 * docs/voice-rearchitecture.md §15.3:
 *   - resolveTalkConfig / resolveTalkOverrides (talk-mode is excluded)
 *   - Persona resolution context (persona system is excluded)
 *   - Custom dispatcherPolicy (xopc uses Node 22 native fetch — see ssrf-guard.ts)
 *
 * DECISION: We use `Record<string, unknown>` for the extra-config slot rather
 * than openclaw's generic `<ExtraConfig extends Record<string, unknown>>`. The
 * generic adds significant TypeScript complexity but no runtime safety; we
 * declare per-provider config types in each provider file's own normalizer.
 *
 * DECISION: `voiceCompatibleResponseFormats` defaults to `['opus']` if omitted,
 * because Telegram voice notes require opus/ogg. Providers that natively support
 * opus output (OpenAI, ElevenLabs) can rely on this; others (MiniMax mp3-only)
 * pass an empty array and downstream ffmpeg-compresses to opus.
 */

import {
  ProviderHttpError,
  fetchWithTimeoutGuarded,
  normalizeBaseUrl as normalizeBaseUrlGeneric,
  postJsonRequest,
} from '../../media-shared/http/index.js';
import { createLogger } from '../../utils/logger.js';

import type {
  SpeechDirectiveTokenParseContext,
  SpeechDirectiveTokenParseResult,
  SpeechProviderConfig,
  SpeechProviderConfiguredContext,
  SpeechProviderOverrides,
  SpeechProviderPlugin,
  SpeechProviderResolveConfigContext,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
  SpeechVoiceOption,
} from './speech-provider-types.js';

const log = createLogger('SpeechProvider:OpenAiCompat');

interface OpenAiCompatibleBaseConfig {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  voice: string;
  speed?: number;
  responseFormat?: string;
}

export type OpenAiCompatibleSpeechProviderConfig = OpenAiCompatibleBaseConfig &
  Record<string, unknown>;

export interface OpenAiCompatibleSpeechProviderExtraJsonBodyField {
  /** Key to read from normalized config. */
  configKey: string;
  /** Key to send in the HTTP body. Defaults to `configKey`. */
  requestKey?: string;
}

export interface OpenAiCompatibleSpeechProviderOptions {
  /** Canonical provider id (e.g. "openai", "minimax"). */
  id: string;
  /** Optional aliases for back-compat config strings. */
  aliases?: readonly string[];
  /** Human-readable label for error messages and logs (e.g. "OpenAI", "MiniMax"). */
  label: string;
  /** Sort key for UI auto-fallback ordering. Lower = higher priority. */
  autoSelectOrder: number;
  /** Allowed model ids. Used by listVoices and validation. */
  models: readonly string[];
  /** Allowed voice ids. */
  voices: readonly string[];
  /** Default model when config does not specify. */
  defaultModel: string;
  /** Default voice. */
  defaultVoice: string;
  /** Default base URL (e.g. "https://api.openai.com/v1"). */
  defaultBaseUrl: string;
  /** Env var name for the api key (e.g. "OPENAI_API_KEY"). */
  envKey: string;
  /** Allowed response formats. */
  responseFormats: readonly string[];
  /** Default response format (e.g. "opus" for OpenAI, "mp3" for MiniMax). */
  defaultResponseFormat: string;
  /** Response formats that produce a voice-note-compatible buffer (no ffmpeg needed). */
  voiceCompatibleResponseFormats?: readonly string[];
  /** Extra static headers (e.g. `{ "OpenAI-Beta": "..." }`). Auth header is added automatically. */
  extraHeaders?: Record<string, string>;
  /** Read provider-specific extra config keys (e.g. MiniMax's `groupId`). */
  readExtraConfig?: (raw: Record<string, unknown> | undefined) => Record<string, unknown>;
  /** Provider-specific extra body fields to copy from config into request JSON. */
  extraJsonBodyFields?: readonly OpenAiCompatibleSpeechProviderExtraJsonBodyField[];
  /** Override the API error label (defaults to `${label} TTS API error`). */
  apiErrorLabel?: string;
  /** Override the missing-key error message. */
  missingApiKeyError?: string;
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

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function compactKey(value: string): string {
  return value.replace(/[^a-z0-9]+/giu, '').toLowerCase();
}

function normalizeResponseFormat(label: string, formats: readonly string[], value: unknown): string | undefined {
  const next = trimToUndefined(value)?.toLowerCase();
  if (!next) {
    return undefined;
  }
  if (formats.includes(next)) {
    return next;
  }
  throw new Error(`Invalid ${label} speech responseFormat: ${next}`);
}

function buildExtraJsonBodyFields(
  config: OpenAiCompatibleSpeechProviderConfig,
  fields: readonly OpenAiCompatibleSpeechProviderExtraJsonBodyField[] | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of fields ?? []) {
    const value = config[field.configKey];
    if (value !== undefined && value !== null && value !== '') {
      body[field.requestKey ?? field.configKey] = value;
    }
  }
  return body;
}

function readSpeechOverrides(overrides: SpeechProviderOverrides | undefined): {
  model?: string;
  voice?: string;
  speed?: number;
} {
  if (!overrides) {
    return {};
  }
  return {
    model: trimToUndefined(overrides.model ?? overrides.modelId),
    voice: trimToUndefined(overrides.voice ?? overrides.voiceId),
    speed: asFiniteNumber(overrides.speed),
  };
}

function parseDirectiveTokenInternal(
  ctx: SpeechDirectiveTokenParseContext,
  providerConfigKey: string,
): SpeechDirectiveTokenParseResult {
  const compactProviderKey = compactKey(providerConfigKey);
  switch (ctx.key) {
    case 'voice':
    case 'voice_id':
    case 'voiceid':
    case `${providerConfigKey}_voice`:
    case `${compactProviderKey}voice`:
      if (!ctx.policy.allowVoice) {
        return { handled: true };
      }
      return { handled: true, overrides: { voice: ctx.value } };
    case 'model':
    case 'model_id':
    case 'modelid':
    case `${providerConfigKey}_model`:
    case `${compactProviderKey}model`:
      if (!ctx.policy.allowModelId) {
        return { handled: true };
      }
      return { handled: true, overrides: { model: ctx.value } };
    case 'speed': {
      const speed = asFiniteNumber(ctx.value);
      if (speed === undefined) {
        return { handled: true, warnings: [`Invalid speed value: ${ctx.value}`] };
      }
      return { handled: true, overrides: { speed } };
    }
    default:
      return { handled: false };
  }
}

export function createOpenAiCompatibleSpeechProvider(
  options: OpenAiCompatibleSpeechProviderOptions,
): SpeechProviderPlugin {
  const providerConfigKey = options.id;
  const voiceCompatibleResponseFormats = options.voiceCompatibleResponseFormats ?? ['opus'];

  function readExtraConfig(raw: Record<string, unknown> | undefined): Record<string, unknown> {
    return options.readExtraConfig?.(raw) ?? {};
  }

  function normalizeConfig(rawConfig: Record<string, unknown>): OpenAiCompatibleSpeechProviderConfig {
    const raw = asObject(rawConfig[providerConfigKey]) ?? rawConfig;
    return {
      apiKey: trimToUndefined(raw.apiKey),
      baseUrl: trimToUndefined(raw.baseUrl)
        ? normalizeBaseUrlGeneric(String(raw.baseUrl))
        : undefined,
      model: trimToUndefined(raw.model ?? raw.modelId) ?? options.defaultModel,
      voice: trimToUndefined(raw.voice ?? raw.voiceId) ?? options.defaultVoice,
      speed: asFiniteNumber(raw.speed),
      responseFormat: normalizeResponseFormat(options.label, options.responseFormats, raw.responseFormat),
      ...readExtraConfig(raw),
    };
  }

  function readProviderConfig(config: SpeechProviderConfig): OpenAiCompatibleSpeechProviderConfig {
    return {
      apiKey: trimToUndefined(config.apiKey),
      baseUrl: trimToUndefined(config.baseUrl)
        ? normalizeBaseUrlGeneric(String(config.baseUrl))
        : undefined,
      model: trimToUndefined(config.model ?? config.modelId) ?? options.defaultModel,
      voice: trimToUndefined(config.voice ?? config.voiceId) ?? options.defaultVoice,
      speed: asFiniteNumber(config.speed),
      responseFormat:
        normalizeResponseFormat(options.label, options.responseFormats, config.responseFormat) ??
        options.defaultResponseFormat,
      ...readExtraConfig(config),
    };
  }

  function resolveApiKey(providerConfig: OpenAiCompatibleSpeechProviderConfig): string | undefined {
    return providerConfig.apiKey ?? trimToUndefined(process.env[options.envKey]);
  }

  function resolveBaseUrl(providerConfig: OpenAiCompatibleSpeechProviderConfig): string {
    return providerConfig.baseUrl ?? options.defaultBaseUrl.replace(/\/+$/u, '');
  }

  return {
    id: options.id,
    aliases: options.aliases,

    resolveConfig: (ctx: SpeechProviderResolveConfigContext) => normalizeConfig(ctx.rawConfig),

    isConfigured: (ctx: SpeechProviderConfiguredContext) =>
      Boolean(resolveApiKey(readProviderConfig(ctx.providerConfig))),

    parseDirectiveToken: (ctx) => parseDirectiveTokenInternal(ctx, providerConfigKey),

    listVoices: async (): Promise<SpeechVoiceOption[]> =>
      options.voices.map((voice) => ({ id: voice, name: voice })),

    synthesize: async (req: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> => {
      const config = readProviderConfig(req.providerConfig);
      const overrides = readSpeechOverrides(req.providerOverrides);
      const apiKey = resolveApiKey(config);
      if (!apiKey) {
        throw new Error(options.missingApiKeyError ?? `${options.label} API key missing`);
      }
      const baseUrl = resolveBaseUrl(config);
      const responseFormat = config.responseFormat ?? options.defaultResponseFormat;
      const speed = overrides.speed ?? config.speed;
      const model = overrides.model ?? config.model;
      const voice = overrides.voice ?? config.voice;

      const url = `${baseUrl}/audio/speech`;
      log.debug(
        { provider: options.id, model, voice, responseFormat, baseUrl, target: req.target },
        `Calling ${options.label} TTS`,
      );

      // postJsonRequest already throws ProviderHttpError on non-2xx.
      const response = await postJsonRequest(url, {
        timeoutMs: req.timeoutMs,
        label: options.apiErrorLabel ?? `${options.label} TTS API error`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...options.extraHeaders,
        },
        body: {
          model,
          input: req.text,
          voice,
          response_format: responseFormat,
          ...(speed === undefined ? {} : { speed }),
          ...buildExtraJsonBodyFields(config, options.extraJsonBodyFields),
        },
      });

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      return {
        audioBuffer,
        outputFormat: responseFormat,
        fileExtension: responseFormat,
        voiceCompatible: voiceCompatibleResponseFormats.includes(responseFormat),
      };
    },

    /**
     * Streaming via OpenAI's POST /audio/speech (the response body itself is
     * the audio stream — no SSE / WebSocket needed). We do NOT call assertOk
     * via postJsonRequest because we want to surface the body as-is for
     * streaming consumers; instead we manually check status and convert to
     * ProviderHttpError on failure (matches openclaw behavior).
     */
    synthesizeStream: async (req) => {
      const config = readProviderConfig(req.providerConfig);
      const overrides = readSpeechOverrides(req.providerOverrides);
      const apiKey = resolveApiKey(config);
      if (!apiKey) {
        throw new Error(options.missingApiKeyError ?? `${options.label} API key missing`);
      }
      const baseUrl = resolveBaseUrl(config);
      const responseFormat = config.responseFormat ?? options.defaultResponseFormat;
      const speed = overrides.speed ?? config.speed;
      const model = overrides.model ?? config.model;
      const voice = overrides.voice ?? config.voice;

      const response = await fetchWithTimeoutGuarded(`${baseUrl}/audio/speech`, {
        timeoutMs: req.timeoutMs,
        label: options.apiErrorLabel ?? `${options.label} TTS streaming`,
        init: {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            accept: 'application/octet-stream',
            ...options.extraHeaders,
          },
          body: JSON.stringify({
            model,
            input: req.text,
            voice,
            response_format: responseFormat,
            stream: true,
            ...(speed === undefined ? {} : { speed }),
            ...buildExtraJsonBodyFields(config, options.extraJsonBodyFields),
          }),
        },
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => undefined);
        throw new ProviderHttpError({
          label: options.apiErrorLabel ?? `${options.label} TTS streaming`,
          status: response.status,
          detail: detail?.slice(0, 220),
        });
      }
      if (!response.body) {
        throw new Error(`${options.label} TTS streaming: empty response body`);
      }

      return {
        audioStream: response.body,
        outputFormat: responseFormat,
        fileExtension: responseFormat,
        voiceCompatible: voiceCompatibleResponseFormats.includes(responseFormat),
      };
    },
  };
}
