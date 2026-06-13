/**
 * Voice routes — POST /api/voice/transcribe
 *
 * Single endpoint that:
 *   1. Runs STT (Whisper preferred for low latency, Alibaba fallback)
 *   2. Optionally runs LLM refine on the raw transcript
 *   3. Returns { raw, refined?, language }
 *
 * LLM refine is auto-applied when a model is resolvable; gracefully degrades
 * to raw-only when no LLM is configured.
 */

import type { Hono } from 'hono';
import { complete, type UserMessage } from '@earendil-works/pi-ai';

import type { Config } from '../../../config/schema.js';
import { getDefaultModelSync, resolveModel } from '../../../providers/index.js';
import { isSTTAvailable, transcribe } from '../../../voice/stt/index.js';
import { isTTSAvailable, mergeTtsConfigFromAppConfig, speak } from '../../../voice/tts/index.js';
import { listTtsProvidersForApi } from '../../../voice/tts/list-providers.js';
import { listSttProvidersForApi } from '../../../voice/stt/list-providers.js';
import { mergeSttConfigFromAppConfig } from '../../../channels/attachments/voice-stt-webchat.js';
import { resolveSttProviderConfigSlice } from '../../../voice/stt/config-slice.js';
import { resolveTtsProviderConfigSlice } from '../../../voice/tts/config-slice.js';
import { createGatewayRouteLogger } from '../lib/route-logger.js';
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

const REFINE_SYSTEM_PROMPT = `你是语音转文字后处理助手。将语音转写原文整理为高质量文本输入。

规则：
1. 修正明显的语音识别错误
2. 添加正确的标点符号
3. 去除口语赘词（嗯、啊、那个、就是说、然后就是）
4. 保持原意不变，不要扩写或改变语义
5. 如果原文已经很好，原样输出
6. 只输出整理后的文字，不要解释`;

function resolveRefineModel(config: Config | undefined): ReturnType<typeof resolveModel> | null {
  const envRef = process.env.XOPC_VOICE_REFINE_MODEL?.trim();
  if (envRef) {
    try {
      return resolveModel(envRef);
    } catch { /* fall through */ }
  }
  for (const candidate of ['openai/gpt-4o-mini', 'google/gemini-2.0-flash']) {
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

  const model = resolveRefineModel(config);
  if (!model) {
    log.debug('No LLM model available for voice refine; returning raw only');
    return undefined;
  }

  try {
    const userMsg: UserMessage = {
      role: 'user',
      content: `${REFINE_SYSTEM_PROMPT}\n\n原文：${raw}`,
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

    const result = await complete(
      model,
      { messages: [userMsg] },
      {
        maxTokens: Math.min(raw.length * 3, 4096),
        temperature: 0.2,
        signal: mergedSignal as AbortSignal,
      },
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

  /**
   * POST /api/voice/tts-test
   *
   * Body: { text: string, provider?: string, model?: string, voice?: string }
   * Response: { ok: true, payload: { audio: string, format: string, provider: string } }
   */
  authenticated.post('/api/voice/tts-test', strictRateLimitMiddleware, async (c) => {
    let body: { text?: unknown; provider?: unknown; model?: unknown; voice?: unknown } = {};
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
    const ttsConfig = {
      ...baseTtsConfig,
      enabled: true,
      provider,
      fallback: { enabled: false, order: [provider] },
    };

    if (!isTTSAvailable(ttsConfig)) {
      return c.json({
        ok: false,
        error: { message: `TTS provider "${provider}" is not configured.` },
      }, 503);
    }

    try {
      const result = await speak(text, ttsConfig, {
        appConfig: config,
        parseDirectives: false,
        tts: {
          ...(typeof body.model === 'string' && body.model.trim() ? { model: body.model.trim() } : {}),
          ...(typeof body.voice === 'string' && body.voice.trim() ? { voice: body.voice.trim() } : {}),
        },
      });
      return c.json({
        ok: true,
        payload: {
          audio: result.audio.toString('base64'),
          format: result.format,
          provider: result.provider,
          ...(result.duration !== undefined ? { duration: result.duration } : {}),
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ errorMessage: msg, provider }, 'Voice TTS test failed');
      return c.json({ ok: false, error: { message: `TTS test failed: ${msg}` } }, 502);
    }
  });

  /**
   * POST /api/voice/transcribe
   *
   * Body: { audio: string (base64), mimeType: string, language?: string }
   * Response: { ok: true, payload: { raw: string, refined?: string, language?: string } }
   */
  authenticated.post('/api/voice/transcribe', async (c) => {
    let body: { audio?: string; mimeType?: string; language?: string } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON body' } }, 400);
    }

    const { audio, mimeType, language } = body;
    if (!audio || typeof audio !== 'string') {
      return c.json({ ok: false, error: { message: 'Missing required field: audio (base64)' } }, 400);
    }
    if (!mimeType || typeof mimeType !== 'string') {
      return c.json({ ok: false, error: { message: 'Missing required field: mimeType' } }, 400);
    }

    // Decode base64 audio
    let audioBuffer: Buffer;
    try {
      audioBuffer = Buffer.from(audio, 'base64');
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid base64 audio data' } }, 400);
    }

    if (audioBuffer.length === 0) {
      return c.json({ ok: false, error: { message: 'Empty audio data' } }, 400);
    }
    if (audioBuffer.length > MAX_AUDIO_BYTES) {
      return c.json({ ok: false, error: { message: 'Audio data exceeds 25 MB limit' } }, 400);
    }

    // Resolve STT config from app config
    const config = service.currentConfig as Config;
    const sttConfigRaw = config.tools?.media?.audio;
    const sttConfig = mergeSttConfigFromAppConfig(sttConfigRaw, config.tools?.media);

    if (!isSTTAvailable(sttConfig)) {
      return c.json({
        ok: false,
        error: { message: 'STT is not configured. Enable STT in gateway config (tools.media.audio).' },
      }, 503);
    }

    // Run STT
    let raw: string;
    let detectedLanguage: string | undefined;
    try {
      const result = await transcribe(audioBuffer, sttConfig, {
        language: language || (sttConfig.provider === 'alibaba' ? 'zh' : undefined),
      });
      raw = result.text;
      detectedLanguage = result.language ?? language;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ errorMessage: msg }, 'Voice transcription failed');
      return c.json({ ok: false, error: { message: `Transcription failed: ${msg}` } }, 502);
    }

    if (!raw.trim()) {
      return c.json({
        ok: true,
        payload: { raw: '', language: detectedLanguage },
      });
    }

    // Run LLM refine (auto, best-effort)
    const refined = await refineTranscript(raw, config);

    return c.json({
      ok: true,
      payload: {
        raw,
        ...(refined ? { refined } : {}),
        ...(detectedLanguage ? { language: detectedLanguage } : {}),
      },
    });
  });
}
