/**
 * TTS directive parser.
 *
 * Parses `[[tts:key=value]]` and `[[tts:text]]...[[/tts:text]]` blocks.
 *
 * Per-provider key handling (voice/model/speed) is delegated to each
 * `SpeechProviderPlugin.parseDirectiveToken`. The parser:
 *   1. Pulls out the `text` block and the global `provider` token here (these
 *      are cross-provider concerns).
 *   2. For every other token, asks each registered provider via
 *      `parseDirectiveToken({ key, value, policy })`. The first provider whose
 *      result has `handled === true` wins; its returned overrides are merged
 *      into `overrides[provider.id]`.
 *   3. Tokens that no provider handles produce a warning (helps catch typos).
 *
 * Adding a new provider with a new directive key (e.g. `[[tts:emotion=happy]]`)
 * requires no change to this file — the provider's own `parseDirectiveToken`
 * declares which keys it owns.
 */

import { createLogger } from '../../utils/logger.js';

import './providers/index.js'; // side-effect: register built-in providers
import { listSpeechProviders } from './speech-registry.js';
import type { TTSModelOverrideConfig, TTSProvider, TtsDirectiveOverrides, TtsDirectiveParseResult } from './types.js';

const log = createLogger('TTS:Directives');

const VALID_PROVIDERS: TTSProvider[] = ['openai', 'alibaba', 'edge', 'minimax'];

function isValidProvider(value: string): value is TTSProvider {
  return VALID_PROVIDERS.includes(value as TTSProvider);
}

function parseNumber(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Apply a provider-handled override into the bucket for `providerId`. Mutates
 * `overrides` in place. Maps the SpeechProviderOverrides keys (model/voice/speed)
 * onto the per-provider bucket in TtsDirectiveOverrides.
 */
function recordProviderOverride(
  overrides: TtsDirectiveOverrides,
  providerId: string,
  patch: { model?: string; voice?: string; speed?: number },
): void {
  if (!isValidProvider(providerId)) {
    return;
  }
  const bucket = (overrides[providerId] as Record<string, unknown> | undefined) ?? {};
  if (patch.voice !== undefined) {
    bucket.voice = patch.voice;
  }
  if (patch.model !== undefined) {
    bucket.model = patch.model;
  }
  if (patch.speed !== undefined) {
    bucket.speed = patch.speed;
  }
  (overrides as Record<string, unknown>)[providerId] = bucket;
}

export function parseTtsDirectives(
  text: string,
  policy: TTSModelOverrideConfig = { enabled: true },
): TtsDirectiveParseResult {
  if (!policy.enabled) {
    return {
      cleanedText: text,
      hasDirective: false,
      overrides: {},
      warnings: [],
    };
  }

  const overrides: TtsDirectiveOverrides = {};
  const warnings: string[] = [];
  let cleanedText = text;
  let hasDirective = false;

  // 1. Pull out [[tts:text]]...[[/tts:text]] blocks (cross-provider concern).
  const textBlockRegex = /\[\[tts:text\]\]([\s\S]*?)\[\[\/tts:text\]\]/gi;
  cleanedText = cleanedText.replace(textBlockRegex, (_match, inner: string) => {
    hasDirective = true;
    if (policy.allowText && overrides.ttsText === undefined) {
      overrides.ttsText = inner.trim();
    }
    return '';
  });

  const providers = listSpeechProviders();

  // 2. Parse [[tts:key=value ...]] tokens.
  const directiveRegex = /\[\[tts:([^\]]+)\]\]/gi;
  cleanedText = cleanedText.replace(directiveRegex, (_match, body: string) => {
    hasDirective = true;
    const tokens = body.split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      const eqIndex = token.indexOf('=');
      if (eqIndex === -1) {
        continue;
      }
      const key = token.slice(0, eqIndex).toLowerCase().trim();
      const value = token.slice(eqIndex + 1).trim();
      if (!key || !value) {
        continue;
      }

      // Cross-provider: provider switch.
      if (key === 'provider') {
        if (!policy.allowProvider) {
          continue;
        }
        if (isValidProvider(value)) {
          overrides.provider = value;
        } else {
          warnings.push(`Invalid provider "${value}"`);
        }
        continue;
      }

      // Cross-provider: speed (validated globally with shared 0.25-4.0 range).
      // Per-provider plugins may also accept their own `speed` token.
      if (key === 'speed') {
        if (!policy.allowVoiceSettings) {
          continue;
        }
        const speed = parseNumber(value);
        if (speed !== undefined && speed >= 0.25 && speed <= 4.0) {
          (overrides as Record<string, unknown>).speed = speed;
        } else {
          warnings.push(`Invalid speed "${value}" (must be 0.25-4.0)`);
        }
        continue;
      }

      // Per-provider: ask each registered plugin. First handled wins.
      let handled = false;
      for (const plugin of providers) {
        if (typeof plugin.parseDirectiveToken !== 'function') {
          continue;
        }
        const result = plugin.parseDirectiveToken({
          key,
          value,
          policy: {
            enabled: policy.enabled ?? true,
            allowText: policy.allowText ?? false,
            allowProvider: policy.allowProvider ?? false,
            allowVoice: policy.allowVoice ?? false,
            allowModelId: policy.allowModelId ?? false,
            allowVoiceSettings: policy.allowVoiceSettings ?? false,
            allowNormalization: policy.allowNormalization ?? false,
            allowSeed: policy.allowSeed ?? false,
          },
        });
        if (result.handled) {
          handled = true;
          if (result.warnings) {
            warnings.push(...result.warnings);
          }
          if (result.overrides) {
            recordProviderOverride(overrides, plugin.id, result.overrides);
          }
          break;
        }
      }
      if (!handled) {
        warnings.push(`Unknown TTS directive key "${key}"`);
      }
    }

    return '';
  });

  cleanedText = cleanedText
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (warnings.length > 0) {
    log.debug({ warnings }, 'TTS directive warnings');
  }

  return {
    cleanedText,
    ttsText: overrides.ttsText,
    hasDirective,
    overrides,
    warnings,
  };
}

export function hasTtsDirectives(text: string): boolean {
  return /\[\[tts:/i.test(text);
}

export function stripTtsDirectives(text: string): string {
  return text
    .replace(/\[\[tts:text\]\][\s\S]*?\[\[\/tts:text\]\]/gi, '')
    .replace(/\[\[tts:[^\]]+\]\]/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildTtsSystemPromptHint(config: {
  enabled: boolean;
  trigger: string;
  maxTextLength?: number;
  modelOverrides?: TTSModelOverrideConfig;
  /** Current channel id (e.g. telegram) for output format hint */
  channel?: string;
  /** Preferred audio format for this channel when known */
  channelAudioFormat?: string;
  /** Whether voice-note style delivery is supported */
  channelVoiceBubble?: boolean;
  /** `text_to_speech` tool is registered */
  textToSpeechTool?: boolean;
}): string | undefined {
  if (!config.enabled) {
    return undefined;
  }

  const hints: string[] = ['Voice (TTS) is enabled.'];

  switch (config.trigger) {
    case 'inbound':
      hints.push("Only use TTS when the user's last message includes audio/voice.");
      break;
    case 'tagged':
      hints.push('Only use TTS when you include [[tts]] or [[tts:text]] tags.');
      break;
    case 'always':
      hints.push('You can use TTS for any message by including [[tts]] tag.');
      break;
    case 'off':
      return undefined;
  }

  const maxLength = config.maxTextLength || 4096;
  hints.push(`Keep spoken text ≤${maxLength} chars.`);

  if (config.channel && (config.channelAudioFormat || config.channelVoiceBubble !== undefined)) {
    const fmt = config.channelAudioFormat ?? 'mp3';
    const bubble =
      config.channelVoiceBubble === true
        ? 'voice-note compatible'
        : config.channelVoiceBubble === false
          ? 'attachment / inline audio only'
          : 'channel default';
    hints.push(`Channel ${config.channel}: prefer ${fmt}; ${bubble}.`);
  }

  if (config.textToSpeechTool) {
    hints.push(
      'You may call `text_to_speech` to generate speech when the user asks you to read aloud or voice fits better than text. Do not use it on every reply.',
    );
  }

  if (config.modelOverrides?.enabled) {
    const allowed: string[] = [];
    if (config.modelOverrides.allowText) allowed.push('[[tts:text]]...[[/tts:text]]');
    if (config.modelOverrides.allowVoice) allowed.push('[[tts:voice=...]]');
    if (config.modelOverrides.allowModelId) allowed.push('[[tts:model=...]]');
    if (config.modelOverrides.allowProvider) allowed.push('[[tts:provider=...]]');

    if (allowed.length > 0) {
      hints.push(`Use ${allowed.join(', ')} to control voice output.`);
    }
  }

  return hints.join('\n');
}
