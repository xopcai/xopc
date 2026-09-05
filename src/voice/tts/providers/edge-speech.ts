/**
 * Edge TTS provider — wraps the `node-edge-tts` package. Requires no API key
 * (Microsoft's Edge browser endpoint is unauthenticated).
 *
 * Implementation notes:
 *   - Temp-file dance (mkdtemp → ttsPromise → readFileSync → rm) is required
 *     because `node-edge-tts` does not expose a stream-to-buffer API.
 *   - `synthesizeStream` is implemented as "synthesize + wrap as single-chunk
 *     stream" so callers see uniform behavior. This is not a true network
 *     stream; it's buffered-then-wrapped.
 *   - `inferEdgeExtension` derives the file extension from Edge's outputFormat
 *     string.
 */

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

const log = createLogger('SpeechProvider:Edge');

const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';
const DEFAULT_LANG = 'zh-CN';
const DEFAULT_OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

interface EdgeTtsConfig extends Record<string, unknown> {
  voice: string;
  lang: string;
  outputFormat: string;
  pitch?: string;
  rate?: string;
  volume?: string;
  proxy?: string;
  enabled: boolean;
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function inferEdgeExtension(outputFormat: string): { ext: string; format: string } {
  const normalized = outputFormat.toLowerCase();
  if (normalized.includes('webm')) return { ext: 'webm', format: 'webm' };
  if (normalized.includes('opus')) return { ext: 'opus', format: 'opus' };
  if (normalized.includes('ogg')) return { ext: 'ogg', format: 'ogg' };
  if (normalized.includes('wav') || normalized.includes('riff') || normalized.includes('pcm')) {
    return { ext: 'wav', format: 'wav' };
  }
  return { ext: 'mp3', format: 'mp3' };
}

function normalizeConfig(rawConfig: Record<string, unknown>): EdgeTtsConfig {
  const raw = asObject(rawConfig.edge) ?? rawConfig;
  return {
    voice: trimToUndefined(raw.voice ?? raw.voiceId) ?? DEFAULT_VOICE,
    lang: trimToUndefined(raw.lang) ?? DEFAULT_LANG,
    outputFormat: trimToUndefined(raw.outputFormat) ?? DEFAULT_OUTPUT_FORMAT,
    pitch: trimToUndefined(raw.pitch),
    rate: trimToUndefined(raw.rate),
    volume: trimToUndefined(raw.volume),
    proxy: trimToUndefined(raw.proxy),
    enabled: raw.enabled !== false, // default-on
  };
}

function readProviderConfig(config: SpeechProviderConfig): EdgeTtsConfig {
  return {
    voice: trimToUndefined(config.voice ?? config.voiceId) ?? DEFAULT_VOICE,
    lang: trimToUndefined(config.lang) ?? DEFAULT_LANG,
    outputFormat: trimToUndefined(config.outputFormat) ?? DEFAULT_OUTPUT_FORMAT,
    pitch: trimToUndefined(config.pitch),
    rate: trimToUndefined(config.rate),
    volume: trimToUndefined(config.volume),
    proxy: trimToUndefined(config.proxy),
    enabled: config.enabled !== false,
  };
}

function parseDirectiveTokenInternal(
  ctx: SpeechDirectiveTokenParseContext,
): SpeechDirectiveTokenParseResult {
  switch (ctx.key) {
    case 'voice':
    case 'voice_id':
    case 'voiceid':
    case 'edge_voice':
    case 'edgevoice':
      if (!ctx.policy.allowVoice) {
        return { handled: true };
      }
      return { handled: true, overrides: { voice: ctx.value } };
    default:
      return { handled: false };
  }
}

async function waitForNonEmptyFile(filePath: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + Math.min(Math.max(timeoutMs, 1000), 5000);
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason;
    try {
      if (statSync(filePath).size > 0) return;
    } catch {
      // The Edge package may resolve before the file is visible on slower filesystems.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function synthesizeToBuffer(
  text: string,
  config: EdgeTtsConfig,
  voiceOverride: string | undefined,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ buffer: Buffer; outputFormat: string; ext: string }> {
  // Lazy import — node-edge-tts loads ws transitively; skip cost for users that
  // never enable the edge provider.
  const { EdgeTTS } = await import('node-edge-tts');

  const voice = voiceOverride ?? config.voice;
  const tempDir = mkdtempSync(path.join(tmpdir(), 'tts-edge-'));
  const { ext, format } = inferEdgeExtension(config.outputFormat);
  const outputPath = path.join(tempDir, `speech-${Date.now()}.${ext}`);

  try {
    log.debug(
      { voice, outputFormat: config.outputFormat, textLength: text.length },
      'Calling Edge TTS',
    );
    const tts = new EdgeTTS({
      voice,
      lang: config.lang,
      outputFormat: config.outputFormat,
      proxy: config.proxy,
      rate: config.rate,
      pitch: config.pitch,
      volume: config.volume,
      timeout: timeoutMs,
    });
    await withAbort(tts.ttsPromise(text, outputPath), signal);
    await waitForNonEmptyFile(outputPath, timeoutMs, signal);
    const buffer = readFileSync(outputPath);
    if (buffer.length === 0) {
      throw new Error(`Edge TTS produced an empty ${format} file for voice ${voice}`);
    }
    return { buffer, outputFormat: format, ext };
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      log.warn({ err: cleanupError, tempDir }, 'Failed to cleanup Edge TTS temp directory');
    }
  }
}

export const edgeSpeechProvider: SpeechProviderPlugin = {
  id: 'edge',
  autoSelectOrder: 100,

  resolveConfig: (ctx: SpeechProviderResolveConfigContext) => normalizeConfig(ctx.rawConfig),

  isConfigured: (ctx: SpeechProviderConfiguredContext) => readProviderConfig(ctx.providerConfig).enabled,

  parseDirectiveToken: parseDirectiveTokenInternal,

  // Edge has hundreds of voices; we don't enumerate them statically. UI should
  // call upstream Microsoft endpoint for the full catalog.
  listVoices: async () => [{ id: DEFAULT_VOICE, name: DEFAULT_VOICE, locale: DEFAULT_LANG }],

  synthesize: async (req: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> => {
    const config = readProviderConfig(req.providerConfig);
    if (!config.enabled) {
      throw new Error('Edge TTS is disabled in config (messages.tts.providers.edge.enabled = false)');
    }
    const overrides = req.providerOverrides ?? {};
    const voiceOverride = trimToUndefined(overrides.voice ?? overrides.voiceId);
    const { buffer, outputFormat, ext } = await synthesizeToBuffer(
      req.text,
      config,
      voiceOverride,
      req.timeoutMs,
      req.signal,
    );
    return {
      audioBuffer: buffer,
      outputFormat,
      fileExtension: ext,
      voiceCompatible: outputFormat === 'opus' || outputFormat === 'ogg',
    };
  },

};

registerSpeechProvider(edgeSpeechProvider);
