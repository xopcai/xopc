import type { TTSProvider, TtsDirectiveParseResult, TtsDirectiveOverrides, TTSModelOverrideConfig } from './types.js';
import { OPENAI_TTS_VOICES, OPENAI_TTS_MODELS } from './providers/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TTS:Directives');

const VALID_PROVIDERS: TTSProvider[] = ['openai', 'alibaba', 'edge'];
const VALID_OPENAI_VOICES_SET = new Set(OPENAI_TTS_VOICES);
const VALID_OPENAI_MODELS_SET = new Set(OPENAI_TTS_MODELS);

function isValidProvider(value: string): value is TTSProvider {
  return VALID_PROVIDERS.includes(value as TTSProvider);
}

function isValidOpenAIVoice(value: string): boolean {
  return VALID_OPENAI_VOICES_SET.has(value as typeof OPENAI_TTS_VOICES[number]);
}

function isValidOpenAIModel(value: string): boolean {
  return VALID_OPENAI_MODELS_SET.has(value as typeof OPENAI_TTS_MODELS[number]);
}

function parseNumber(value: string): number | undefined {
  const parsed = parseFloat(value);
  return isFinite(parsed) ? parsed : undefined;
}

export function parseTtsDirectives(
  text: string,
  policy: TTSModelOverrideConfig = { enabled: true }
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

  const textBlockRegex = /\[\[tts:text\]\]([\s\S]*?)\[\[\/tts:text\]\]/gi;
  cleanedText = cleanedText.replace(textBlockRegex, (match, inner: string) => {
    hasDirective = true;
    if (policy.allowText && overrides.ttsText === undefined) {
      overrides.ttsText = inner.trim();
    }
    return '';
  });

  const directiveRegex = /\[\[tts:([^\]]+)\]\]/gi;
  cleanedText = cleanedText.replace(directiveRegex, (match, body: string) => {
    hasDirective = true;
    const tokens = body.split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      const eqIndex = token.indexOf('=');
      if (eqIndex === -1) continue;

      const key = token.slice(0, eqIndex).toLowerCase().trim();
      const value = token.slice(eqIndex + 1).trim();

      if (!key || !value) continue;

      try {
        switch (key) {
          case 'provider':
            if (policy.allowProvider) {
              if (isValidProvider(value)) {
                overrides.provider = value;
              } else {
                warnings.push(`Invalid provider "${value}"`);
              }
            }
            break;

          case 'voice':
          case 'openai_voice':
          case 'openaivoice':
            if (policy.allowVoice) {
              overrides.openai = { ...overrides.openai, voice: value };
            }
            break;

          case 'model':
          case 'modelid':
          case 'model_id':
          case 'openai_model':
          case 'openaimodel':
            if (policy.allowModelId) {
              overrides.openai = { ...overrides.openai, model: value };
            }
            break;

          case 'speed':
            if (policy.allowVoiceSettings) {
              const speed = parseNumber(value);
              if (speed !== undefined && speed >= 0.25 && speed <= 4.0) {
                (overrides as Record<string, unknown>).speed = speed;
              } else {
                warnings.push(`Invalid speed "${value}" (must be 0.25-4.0)`);
              }
            }
            break;

          case 'alibaba_voice':
          case 'alibabavoice':
            if (policy.allowVoice) {
              overrides.alibaba = { ...overrides.alibaba, voice: value };
            }
            break;

          case 'alibaba_model':
          case 'alibabamodel':
            if (policy.allowModelId) {
              overrides.alibaba = { ...overrides.alibaba, model: value };
            }
            break;

          case 'edge_voice':
          case 'edgevoice':
            if (policy.allowVoice) {
              overrides.edge = { ...overrides.edge, voice: value };
            }
            break;

          default:
            break;
        }
      } catch (err) {
        warnings.push(`Error parsing "${key}": ${err instanceof Error ? err.message : String(err)}`);
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
}): string | undefined {
  if (!config.enabled) {
    return undefined;
  }

  const hints: string[] = ['Voice (TTS) is enabled.'];

  switch (config.trigger) {
    case 'inbound':
      hints.push('Only use TTS when the user\'s last message includes audio/voice.');
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