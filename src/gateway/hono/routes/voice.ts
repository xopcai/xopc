import { voiceSelectionSchema } from '@xopcai/realtime-protocol/voice';
import { voiceSettingsCatalog, selectPlatformVoice } from '../../../voice/platform-settings.js';
/**
 * Voice routes — POST /api/voice/transcriptions (multipart).
 *
 * Transcription returns the provider text immediately. Optional LLM cleanup
 * uses a separate endpoint so it never delays the raw transcript.
 */

import type { Context, Hono } from 'hono';
import { type UserMessage } from '@earendil-works/pi-ai/compat';
import { createVoiceSessionRequestSchema } from '@xopcai/realtime-protocol/voice';
import { z } from 'zod';

import type { Config } from '../../../config/schema.js';
import { withModelConfigLock } from '../../../session/model-config-lock.js';
import { getDefaultModelSync, resolveModel } from '../../../providers/index.js';
import { completeWithResolvedCredentials } from '../../../providers/model-call.js';
import {
  isSTTAvailable,
  mergeSttConfigFromAppConfig,
  STTTranscriptionError,
  transcribe,
} from '../../../voice/stt/index.js';
import { isTTSAvailable, mergeTtsConfigFromAppConfig, speak } from '../../../voice/tts/index.js';
import { listTtsProvidersForApi } from '../../../voice/tts/list-providers.js';
import { resolveSpeechProvider } from '../../../voice/tts/factory.js';
import { listSttProvidersForApi } from '../../../voice/stt/list-providers.js';
import { resolveSttProviderConfigSlice } from '../../../voice/stt/config-slice.js';
import { resolveTtsProviderConfigSlice } from '../../../voice/tts/config-slice.js';
import { resolveStreamingStt, resolveStreamingTts, VoiceSessionCreationError } from '../../../voice/realtime/runtime.js';
import { resolveOmniRoute } from '../../../voice/realtime/omniRoute.js';
import { speakStream } from '../../../voice/tts/speak-core.js';
import { createGatewayRouteLogger } from '../lib/route-logger.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createGatewayRouteLogger('Voice');

function readVoiceApiKeyFromConfigFileOnly(
  cfg: Config,
  kind: 'stt' | 'tts',
  providerId: string,
): string | undefined {
  const id = providerId.trim();
  if (!id) return undefined;
  const slice =
    kind === 'stt'
      ? resolveSttProviderConfigSlice(id, cfg.tools?.media?.audio)
      : resolveTtsProviderConfigSlice(id, cfg.messages?.tts);
  const key = slice.apiKey;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

const REFINE_TIMEOUT_MS = 15_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_SPEECH_TEXT_LENGTH = 1_200;
const cancelVoiceSessionSchema = z.strictObject({
  sessionId: z.uuid(),
  ticket: z.string().min(32).max(512),
});

function speechMimeType(format: string): string {
  if (format === 'opus' || format === 'ogg') return 'audio/ogg';
  if (format === 'mp3' || format === 'mpeg') return 'audio/mpeg';
  if (format === 'wav') return 'audio/wav';
  return `audio/${format}`;
}

const LIGHT_REFINE_PROMPT = `你是语音转文字后处理助手。将语音转写原文整理为高质量文本输入。

规则：
1. 修正明显的语音识别错误
2. 添加正确的标点符号
3. 去除口语赘词（嗯、啊、那个、就是说、然后就是）
4. 保持原意不变，不要扩写或改变语义
5. 如果原文已经很好，原样输出
6. 只输出整理后的文字，不要解释`;

const PUNCTUATION_REFINE_PROMPT = `为语音转写原文补充标点和合理分段。不要删词、改写、扩写或改变语义。只输出处理后的文字。`;

function resolveRefineModel(
  config: Config | undefined,
  configuredRef?: string,
): ReturnType<typeof resolveModel> | null {
  if (configuredRef) {
    try {
      return resolveModel(configuredRef);
    } catch {
      log.warn({ modelRef: configuredRef }, 'Configured voice refinement model is invalid');
      return null;
    }
  }
  const envRef = process.env.XOPC_VOICE_REFINE_MODEL?.trim();
  if (envRef) {
    try {
      return resolveModel(envRef);
    } catch { /* fall through */ }
  }
  for (const candidate of ['openai/gpt-5.6-luna', 'google/gemini-3.5-flash']) {
    try {
      return resolveModel(candidate);
    } catch { /* next */ }
  }
  try {
    return resolveModel(getDefaultModelSync(config));
  } catch {
    return null;
  }
}

async function refineTranscript(
  raw: string,
  config: Config | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!raw.trim()) return undefined;

  const refinement = config?.voice?.input?.refinement;
  const mode = refinement?.mode ?? 'off';
  if (mode === 'off') return undefined;

  const instruction =
    mode === 'punctuation'
      ? PUNCTUATION_REFINE_PROMPT
      : mode === 'custom'
        ? refinement?.customInstruction?.trim()
        : LIGHT_REFINE_PROMPT;
  if (!instruction) {
    log.warn('Custom voice refinement is enabled without an instruction; returning raw only');
    return undefined;
  }

  const model = resolveRefineModel(config, refinement?.model);
  if (!model) {
    log.debug('No LLM model available for voice refine; returning raw only');
    return undefined;
  }

  try {
    const userMsg: UserMessage = {
      role: 'user',
      content: `${instruction}\n\n原文：${raw}`,
      timestamp: Date.now(),
    };

    const timeoutSignal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(REFINE_TIMEOUT_MS)
        : undefined;
    const mergedSignal =
      signal && timeoutSignal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([signal, timeoutSignal])
        : signal ?? timeoutSignal;

    const result = await completeWithResolvedCredentials(
      model,
      { messages: [userMsg] },
      {
        maxTokens: Math.min(raw.length * 3, 4096),
        temperature: 0.2,
        signal: mergedSignal as AbortSignal,
      },
      undefined,
      { operation: 'voice.select' },
    );

    let out = '';
    if (Array.isArray(result.content)) {
      for (const c of result.content) {
        if (c && typeof c === 'object' && (c as { type?: string }).type === 'text') {
          out += String((c as { text?: string }).text || '');
        }
      }
    }

    const refined = out.trim();
    if (!refined || refined === raw.trim()) return undefined;
    return refined;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn({ errorMessage: msg }, 'Voice refine failed; returning raw only');
    return undefined;
  }
}

export function registerVoiceRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/voice/catalog', (c) => c.json({ ok: true, payload: voiceSettingsCatalog(service.currentConfig as Config) }));
  authenticated.post('/api/voice/catalog/refresh', strictRateLimitMiddleware, async (c) => {
    const result = await service.getModelCatalogSync().refreshNow();
    if (result.error || result.state !== 'ready') return c.json({ ok: false, error: { code: 'CATALOG_REFRESH_FAILED', message: 'Voice catalog could not be refreshed' } }, 503);
    return c.json({ ok: true, payload: voiceSettingsCatalog(service.currentConfig as Config) });
  });
  authenticated.put('/api/voice/selection', strictRateLimitMiddleware, async (c) => {
    const parsed = z.strictObject({ revision: z.string(), selection: voiceSelectionSchema }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { message: 'Invalid voice selection' } }, 400);
    return withModelConfigLock('__voice_settings__', async () => {
      if (voiceSettingsCatalog(service.currentConfig as Config).revision !== parsed.data.revision) return c.json({ ok: false, error: { message: 'Voice settings changed; refresh before saving' } }, 409);
      try {
        const next = selectPlatformVoice(service.currentConfig as Config, parsed.data.selection);
        const result = await service.saveConfig(next);
        if (!result.saved) return c.json({ ok: false, error: { message: result.error } }, 500);
        return c.json({ ok: true, payload: voiceSettingsCatalog(service.currentConfig as Config) });
      } catch (error) { return c.json({ ok: false, error: { message: error instanceof Error ? error.message : 'Voice selection failed' } }, 400); }
    });
  });

  authenticated.get('/api/voice/realtime/status', async (c) => {
    const config = service.currentConfig as Config;
    const stt = resolveStreamingStt(config);
    const tts = resolveStreamingTts(config);
    const omni = await resolveOmniRoute(config).catch(() => null);
    const enabled = config.voice?.realtime?.enabled === true;
    const availability = (configured: boolean) => ({
      available: enabled && configured,
      ...(!enabled ? { reasonCode: 'VOICE_DISABLED' } : !configured ? { reasonCode: 'PROVIDER_UNAVAILABLE' } : {}),
    });
    return c.json({ ok: true, payload: {
      enabled,
      capabilities: {
        dictation: availability(Boolean(stt)),
        assistant: availability(Boolean(stt && tts)),
        natural: availability(Boolean(omni)),
        languages: ['zh', 'en'],
        bargeIn: config.voice?.realtime?.bargeIn ?? true,
        mediaTransports: ['websocket-pcm'],
      },
      defaultMode: config.voice?.realtime?.defaultEngine === 'omni' ? 'natural' : 'assistant',
      omni: omni?.route ?? null,
      stt: stt?.route ?? null,
      tts: tts ? {
        ...tts.route,
        voice: tts.config.providers?.[tts.route.provider]?.voice ?? tts.provider.providerConfig.voice,
      } : null,
    } });
  });

  authenticated.post('/api/voice/realtime/preview', strictRateLimitMiddleware, async (c) => {
    const config = service.currentConfig as Config;
    const route = resolveStreamingTts(config);
    if (!route) return c.json({ ok: false, error: { message: 'Realtime voice output is not configured' } }, 503);
    const controller = new AbortController();
    const signal = AbortSignal.any([c.req.raw.signal, controller.signal, AbortSignal.timeout(20_000)]);
    let result: Awaited<ReturnType<typeof speakStream>> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const text = config.voice?.language === 'en'
        ? 'Hello, I am your assistant. You can talk to me naturally.'
        : '你好，我是你的助手。现在可以和我自然对话了。';
      result = await speakStream(text, route.config, { signal, appConfig: config, allowFallback: false, parseDirectives: false });
      if (result.outputFormat !== 'pcm') throw new Error('Realtime preview requires PCM audio');
      reader = result.audioStream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 960_000) throw new Error('Realtime preview audio exceeds the limit');
        chunks.push(value);
      }
      if (size === 0 || size % 2 !== 0) throw new Error('Realtime preview returned invalid audio');
      return c.json({ ok: true, payload: { audio: Buffer.concat(chunks).toString('base64'), sampleRate: 24_000 } });
    } catch (error) {
      log.warn({ err: error, provider: route.route.provider }, 'Realtime voice preview failed');
      return c.json({ ok: false, error: { message: 'Voice preview failed. Check the provider credentials and try again.' } }, 502);
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      reader?.releaseLock();
      await result?.release();
    }
  });

  for (const action of ['preflight', 'sessions'] as const) authenticated.post(`/api/voice/realtime/${action}`, strictRateLimitMiddleware, async (c) => {
    const parsed = createVoiceSessionRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Invalid realtime voice session request' } }, 400);
    }
    try {
      if (action === 'preflight') {
        await service.voiceRealtime.preflight(parsed.data);
        return c.json({ ok: true });
      }
      const principal = getGatewayPrincipal(c);
      const create = () => service.voiceRealtime.createSession(parsed.data, principal.principalId);
      const payload = parsed.data.conversationId ? await withModelConfigLock(parsed.data.conversationId, create) : await create();
      return c.json({ ok: true, payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Realtime voice is unavailable';
      if (error instanceof VoiceSessionCreationError) {
        return c.json({ ok: false, error: { code: error.code, message } }, error.status);
      }
      return c.json({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message } }, 503);
    }
  });

  authenticated.post('/api/voice/realtime/sessions/cancel', strictRateLimitMiddleware, async (c) => {
    const parsed = cancelVoiceSessionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Invalid realtime voice cancellation request' } }, 400);
    }
    const principal = getGatewayPrincipal(c);
    await service.voiceRealtime.cancelSession(parsed.data.sessionId, parsed.data.ticket, principal.principalId);
    return c.json({ ok: true });
  });

  authenticated.post('/api/voice/language', strictRateLimitMiddleware, async (c) => {
    let body: { language?: unknown } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON body' } }, 400);
    }
    if (body.language !== 'en' && body.language !== 'zh') {
      return c.json({ ok: false, error: { message: 'language must be "en" or "zh"' } }, 400);
    }
    const payload = await service.syncVoiceLanguage(body.language);
    if (payload.error) {
      return c.json({ ok: false, error: { message: payload.error } }, 500);
    }
    return c.json({ ok: true, payload });
  });

  /**
   * GET /api/voice/providers
   *
   * Lists registered SpeechProviderPlugin ids with configured state for the
   * current gateway config (OpenClaw `tts.providers` equivalent).
   */
  authenticated.get('/api/voice/providers', (c) => {
    const config = service.currentConfig as Config;
    const payload = listTtsProvidersForApi(config);
    return c.json({ ok: true, payload });
  });

  authenticated.get('/api/voice/tts-voices', async (c) => {
    const provider = c.req.query('provider')?.trim() ?? '';
    const model = c.req.query('model')?.trim() ?? '';
    if (!provider || !model || provider.length > 100 || model.length > 200) {
      return c.json({ ok: false, error: { message: 'provider and model are required' } }, 400);
    }

    const config = service.currentConfig as Config;
    const baseConfig = c.req.query('purpose') === 'realtime'
      ? resolveStreamingTts(config)?.config
      : mergeTtsConfigFromAppConfig(config.messages?.tts);
    if (!baseConfig) return c.json({ ok: true, payload: { voices: [] } });
    const resolved = resolveSpeechProvider(provider, {
      ...baseConfig,
      provider,
      providers: {
        ...(baseConfig.providers ?? {}),
        [provider]: { ...(baseConfig.providers?.[provider] ?? {}), model },
      },
    });
    if (!resolved?.plugin.listVoices) {
      return c.json({ ok: true, payload: { voices: [] } });
    }
    try {
      const voices = await resolved.plugin.listVoices({
        cfg: config,
        providerConfig: resolved.providerConfig,
      });
      return c.json({ ok: true, payload: { voices } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: { message: `Voice discovery failed: ${message}` } }, 502);
    }
  });

  /**
   * GET /api/voice/stt-providers
   *
   * Lists registered MediaUnderstandingProvider ids with configured state for
   * the current gateway config (OpenClaw `tools.media.audio.providers` equivalent).
   */
  authenticated.get('/api/voice/stt-providers', (c) => {
    const config = service.currentConfig as Config;
    const payload = listSttProvidersForApi(config);
    return c.json({ ok: true, payload });
  });

  /**
   * POST /api/voice/reveal-api-key — return plaintext voice provider apiKey from config file only.
   * Body: `{ kind: 'stt' | 'tts', provider: string }`
   */
  authenticated.post('/api/voice/reveal-api-key', strictRateLimitMiddleware, async (c) => {
    let body: { kind?: unknown; provider?: unknown } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON body' } }, 400);
    }
    const kind = body.kind === 'stt' || body.kind === 'tts' ? body.kind : null;
    const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
    if (!kind) {
      return c.json({ ok: false, error: { message: 'kind must be "stt" or "tts"' } }, 400);
    }
    if (!provider) {
      return c.json({ ok: false, error: { message: 'provider is required' } }, 400);
    }

    const cfg = service.currentConfig as Config;
    const apiKey = readVoiceApiKeyFromConfigFileOnly(cfg, kind, provider);
    return c.json({
      ok: true,
      payload: {
        kind,
        provider,
        apiKey: apiKey ?? null,
        source: apiKey ? ('config' as const) : ('none' as const),
      },
    });
  });

  /** Generate one bounded read-aloud chunk as binary audio. */
  authenticated.post('/api/voice/speech', strictRateLimitMiddleware, async (c) => {
    let body: { text?: unknown; language?: unknown; voice?: unknown } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON body' } }, 400);
    }

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return c.json({ ok: false, error: { message: 'text is required' } }, 400);
    }
    if (text.length > MAX_SPEECH_TEXT_LENGTH) {
      return c.json({ ok: false, error: { message: `text exceeds ${MAX_SPEECH_TEXT_LENGTH} characters` } }, 400);
    }

    const language = typeof body.language === 'string' ? body.language.trim() : '';
    const voice = typeof body.voice === 'string' ? body.voice.trim() : '';
    if (language && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) {
      return c.json({ ok: false, error: { message: 'language must be a valid locale' } }, 400);
    }
    if (voice.length > 100) {
      return c.json({ ok: false, error: { message: 'voice exceeds 100 characters' } }, 400);
    }

    const config = service.currentConfig as Config;
    const baseTtsConfig = mergeTtsConfigFromAppConfig(config.messages?.tts);
    const provider = baseTtsConfig.provider;
    const languageVoice = language.startsWith('en')
      ? 'en-US-MichelleNeural'
      : language.startsWith('zh')
        ? 'zh-CN-XiaoxiaoNeural'
        : undefined;
    const providerOverride = provider === 'edge'
      ? {
          ...(language ? { lang: language } : {}),
          ...(voice || languageVoice ? { voice: voice || languageVoice } : {}),
        }
      : {};
    const ttsConfig = {
      ...baseTtsConfig,
      enabled: true,
      providers: {
        ...(baseTtsConfig.providers ?? {}),
        [provider]: {
          ...(baseTtsConfig.providers?.[provider] ?? {}),
          ...providerOverride,
        },
      },
    };

    if (!isTTSAvailable(ttsConfig)) {
      return c.json({ ok: false, error: { message: `TTS provider \"${provider}\" is not configured.` } }, 503);
    }

    try {
      const result = await speak(text, ttsConfig, {
        appConfig: config,
        parseDirectives: false,
        signal: c.req.raw.signal,
        tts: voice ? { voice } : undefined,
      });
      if (!result.audio.length) {
        throw new Error(`TTS provider \"${result.provider}\" returned empty audio`);
      }
      return new Response(new Uint8Array(result.audio), {
        headers: {
          'Content-Type': speechMimeType(result.format),
          'Content-Length': String(result.audio.length),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Voice-Provider': result.provider,
          ...(language ? { 'X-Voice-Language': language } : {}),
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!c.req.raw.signal.aborted) {
        log.error({ err: error, provider, textLength: text.length }, `Voice speech generation failed: ${msg}`);
      }
      return c.json({ ok: false, error: { message: `Speech generation failed: ${msg}` } }, 502);
    }
  });

  /**
   * POST /api/voice/tts-test
   *
   * Body: { text: string, provider?: string, model?: string, voice?: string }
   * Response: { ok: true, payload: { audio: string, format: string, provider: string } }
   */
  authenticated.post('/api/voice/tts-test', strictRateLimitMiddleware, async (c) => {
    let body: { text?: unknown; provider?: unknown; model?: unknown; voice?: unknown; providerConfig?: unknown } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON body' } }, 400);
    }

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return c.json({ ok: false, error: { message: 'text is required' } }, 400);
    }
    if (text.length > 1000) {
      return c.json({ ok: false, error: { message: 'text exceeds 1000 characters' } }, 400);
    }

    const config = service.currentConfig as Config;
    const baseTtsConfig = mergeTtsConfigFromAppConfig(config.messages?.tts);
    const provider = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : baseTtsConfig.provider;
    const providerConfig =
      body.providerConfig && typeof body.providerConfig === 'object' && !Array.isArray(body.providerConfig)
        ? (body.providerConfig as Record<string, unknown>)
        : undefined;
    const ttsConfig = {
      ...baseTtsConfig,
      enabled: true,
      provider,
      providers: {
        ...(baseTtsConfig.providers ?? {}),
        ...(providerConfig ? { [provider]: { ...(baseTtsConfig.providers?.[provider] ?? {}), ...providerConfig } } : {}),
      },
      fallback: { enabled: false, order: [provider] },
    };

    if (!isTTSAvailable(ttsConfig)) {
      return c.json({
        ok: false,
        error: { message: `TTS provider "${provider}" is not configured.` },
      }, 503);
    }

    try {
      const startedAt = Date.now();
      const result = await speak(text, ttsConfig, {
        appConfig: config,
        parseDirectives: false,
        tts: {
          ...(typeof body.model === 'string' && body.model.trim() ? { model: body.model.trim() } : {}),
          ...(typeof body.voice === 'string' && body.voice.trim() ? { voice: body.voice.trim() } : {}),
        },
      });
      if (!result.audio.length) {
        throw new Error(`TTS provider "${result.provider}" returned empty audio`);
      }
      const mimeType =
        result.format === 'opus' || result.format === 'ogg'
          ? 'audio/ogg'
          : result.format === 'mp3' || result.format === 'mpeg'
            ? 'audio/mpeg'
            : result.format === 'wav'
              ? 'audio/wav'
              : `audio/${result.format}`;
      return c.json({
        ok: true,
        payload: {
          audio: result.audio.toString('base64'),
          mimeType,
          format: result.format,
          provider: result.provider,
          latencyMs: Date.now() - startedAt,
          audioSize: result.audio.length,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ errorMessage: msg, provider }, 'Voice TTS test failed');
      return c.json({ ok: false, error: { message: `TTS test failed: ${msg}` } }, 502);
    }
  });

  type TranscriptionInput = {
    audioBuffer: Buffer;
    mimeType: string;
    fileName: string;
    language?: string;
  };

  const runTranscription = async (c: Context, input: TranscriptionInput) => {
    if (!input.audioBuffer.length) {
      return c.json({ ok: false, error: { message: 'Empty audio data' } }, 400);
    }
    if (input.audioBuffer.length > MAX_AUDIO_BYTES) {
      return c.json({ ok: false, error: { message: 'Audio data exceeds 25 MB limit' } }, 400);
    }
    if (!input.mimeType.toLowerCase().startsWith('audio/')) {
      return c.json({ ok: false, error: { message: 'Uploaded file must have an audio MIME type' } }, 400);
    }

    const config = service.currentConfig as Config;
    const sttConfig = mergeSttConfigFromAppConfig(
      config.tools?.media?.audio,
      config.tools?.media,
    );
    if (!isSTTAvailable(sttConfig)) {
      return c.json({
        ok: false,
        error: { message: 'STT is not configured. Enable STT in gateway config (tools.media.audio).' },
      }, 503);
    }

    const startedAt = Date.now();
    try {
      const result = await transcribe(input.audioBuffer, sttConfig, {
        language: input.language,
        mime: input.mimeType,
        fileName: input.fileName,
        signal: c.req.raw.signal,
      });
      const detectedLanguage = result.language ?? input.language;
      const refinementAvailable = (config.voice?.input?.refinement?.mode ?? 'off') !== 'off';
      return c.json({
        ok: true,
        payload: {
          text: result.text,
          refinementAvailable,
          ...(detectedLanguage ? { language: detectedLanguage } : {}),
          provider: result.provider,
          attempts: result.attempts,
          ...(result.duration !== undefined ? { durationSeconds: result.duration } : {}),
          latencyMs: Date.now() - startedAt,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!c.req.raw.signal.aborted) {
        log.error({ err: error, mimeType: input.mimeType, fileName: input.fileName }, `Voice transcription failed: ${msg}`);
      }
      if (error instanceof STTTranscriptionError) {
        const status = error.reasonCode === 'unsupported_format'
          ? 415
          : error.reasonCode === 'timeout'
            ? 504
            : 502;
        return c.json({
          ok: false,
          error: { code: error.reasonCode, message: `Transcription failed: ${msg}` },
        }, status);
      }
      return c.json({ ok: false, error: { code: 'provider_error', message: `Transcription failed: ${msg}` } }, 502);
    }
  };

  authenticated.post('/api/voice/transcriptions/refine', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null) as { text?: unknown } | null;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return c.json({ ok: false, error: { message: 'Missing transcript text' } }, 400);
    }
    if (text.length > 20_000) {
      return c.json({ ok: false, error: { message: 'Transcript text exceeds 20000 character limit' } }, 413);
    }
    const refined = await refineTranscript(text, service.currentConfig as Config, c.req.raw.signal);
    return c.json({ ok: true, payload: { text: refined ?? text } });
  });

  /** Multipart endpoint used by browser and future native clients. */
  authenticated.post('/api/voice/transcriptions', strictRateLimitMiddleware, async (c) => {
    const contentLength = Number(c.req.header('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES + 1024 * 1024) {
      return c.json({ ok: false, error: { message: 'Audio data exceeds 25 MB limit' } }, 413);
    }
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid multipart form data' } }, 400);
    }
    const audio = form.get('audio');
    if (!(audio instanceof Blob)) {
      return c.json({ ok: false, error: { message: 'Missing required file field: audio' } }, 400);
    }
    const languageValue = form.get('language');
    const language = typeof languageValue === 'string' && languageValue.trim()
      ? languageValue.trim()
      : undefined;
    const fileName = 'name' in audio && typeof audio.name === 'string' && audio.name.trim()
      ? audio.name.trim()
      : `audio-${Date.now()}`;
    return runTranscription(c, {
      audioBuffer: Buffer.from(await audio.arrayBuffer()),
      mimeType: audio.type || 'audio/webm',
      fileName,
      ...(language ? { language } : {}),
    });
  });

}
