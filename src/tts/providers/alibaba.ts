import { BaseTTSProvider, type BaseProviderConfig } from './base.js';
import type { TTSOptions, TTSResult } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('TTS:Alibaba');

export interface AlibabaProviderConfig extends BaseProviderConfig {
  apiKey: string;
  model?: string;
  voice?: string;
}

interface CosyVoiceResponse {
  output: {
    speech_url?: string;
    speech?: string;
    audio?: {
      data?: string;
      url?: string;
      id?: string;
      expires_at?: number;
    };
    finish_reason?: string;
  };
  usage: {
    characters: number;
  };
  request_id: string;
}

export class AlibabaProvider extends BaseTTSProvider {
  readonly name = 'alibaba';

  private apiKey: string;
  private model: string;
  private voice: string;
  private baseUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
  private readonly maxTextLength = 512; // Alibaba TTS API limit

  constructor(config: AlibabaProviderConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.model = config.model || 'qwen-tts';
    this.voice = config.voice || 'longxiaochun';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** Get the maximum text length for this provider */
  getMaxTextLength(): number {
    return this.maxTextLength;
  }

  protected async doSpeak(text: string, options?: TTSOptions): Promise<TTSResult> {
    const voice = options?.voice || this.voice;

    log.debug({ model: this.model, voice, textLength: text.length }, 'Calling Alibaba TTS');

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-DataInspection': 'disable',
      },
      body: JSON.stringify({
        model: this.model,
        input: { text },
        parameters: { voice },
      }),
      signal: this.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Alibaba TTS error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as CosyVoiceResponse;

    if (data.output?.finish_reason === 'null' || !data.output?.audio?.url) {
      throw new Error(`Alibaba TTS API error: ${JSON.stringify(data)}`);
    }

    let audioBuffer: Buffer;
    if (data.output.audio?.url) {
      const audioResponse = await fetch(data.output.audio.url);
      if (!audioResponse.ok) {
        throw new Error(`Failed to fetch audio from URL: ${audioResponse.status} ${audioResponse.statusText}`);
      }
      audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    } else if (data.output.speech) {
      audioBuffer = Buffer.from(data.output.speech, 'base64');
    } else if (data.output.speech_url) {
      const audioResponse = await fetch(data.output.speech_url);
      if (!audioResponse.ok) {
        throw new Error(`Failed to fetch audio from URL: ${audioResponse.status} ${audioResponse.statusText}`);
      }
      audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    } else {
      throw new Error('No audio returned from Alibaba TTS');
    }

    log.debug({ size: audioBuffer.length, characters: data.usage?.characters, requestId: data.request_id }, 'Alibaba TTS completed');

    return {
      audio: audioBuffer,
      format: 'wav',
      provider: this.name,
    };
  }
}
