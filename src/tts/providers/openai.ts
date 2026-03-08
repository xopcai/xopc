import { BaseTTSProvider, type BaseProviderConfig } from './base.js';
import type { TTSOptions, TTSResult } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('TTS:OpenAI');

export const OPENAI_TTS_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] as const;
export const OPENAI_TTS_VOICES = [
  'alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable',
  'juniper', 'marin', 'onyx', 'nova', 'sage', 'shimmer', 'verse'
] as const;

export type OpenAITTSModel = (typeof OPENAI_TTS_MODELS)[number];
export type OpenAITTSVoice = (typeof OPENAI_TTS_VOICES)[number];

export interface OpenAIProviderConfig extends BaseProviderConfig {
  apiKey: string;
  model?: string;
  voice?: string;
  baseUrl?: string;
}

function getOpenAIBaseUrl(configuredUrl?: string): string {
  const envUrl = process.env.OPENAI_TTS_BASE_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, '');
  }
  return 'https://api.openai.com/v1';
}

function isCustomEndpoint(baseUrl: string): boolean {
  return baseUrl !== 'https://api.openai.com/v1';
}

export function isValidOpenAIVoice(voice: string): boolean {
  const baseUrl = getOpenAIBaseUrl();
  if (isCustomEndpoint(baseUrl)) {
    return true;
  }
  return OPENAI_TTS_VOICES.includes(voice as OpenAITTSVoice);
}

export function isValidOpenAIModel(model: string): boolean {
  const baseUrl = getOpenAIBaseUrl();
  if (isCustomEndpoint(baseUrl)) {
    return true;
  }
  return OPENAI_TTS_MODELS.includes(model as OpenAITTSModel);
}

export class OpenAIProvider extends BaseTTSProvider {
  readonly name = 'openai';

  private apiKey: string;
  private model: string;
  private voice: string;
  private baseUrl: string;

  constructor(config: OpenAIProviderConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.model = config.model || 'tts-1';
    this.voice = config.voice || 'alloy';
    this.baseUrl = getOpenAIBaseUrl(config.baseUrl);
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  protected async doSpeak(text: string, options?: TTSOptions): Promise<TTSResult> {
    const model = options?.model || this.model;
    const voice = options?.voice || this.voice;

    if (!isCustomEndpoint(this.baseUrl)) {
      if (!isValidOpenAIModel(model)) {
        throw new Error(`Invalid OpenAI TTS model: ${model}`);
      }
      if (!isValidOpenAIVoice(voice)) {
        throw new Error(`Invalid OpenAI TTS voice: ${voice}`);
      }
    }

    log.debug({ model, voice, textLength: text.length }, 'Calling OpenAI TTS');

    const response = await fetch(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: options?.format || 'opus',
        speed: options?.speed || 1.0,
      }),
      signal: this.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS error: ${response.status} ${error}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    return {
      audio: buffer,
      format: options?.format || 'opus',
      provider: this.name,
    };
  }
}
