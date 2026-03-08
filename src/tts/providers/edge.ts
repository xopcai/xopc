import { BaseTTSProvider, type BaseProviderConfig } from './base.js';
import type { TTSOptions, TTSResult } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('TTS:Edge');

export interface EdgeProviderConfig extends BaseProviderConfig {
  voice?: string;
  lang?: string;
  outputFormat?: string;
  pitch?: string;
  rate?: string;
  volume?: string;
  proxy?: string;
}

const DEFAULT_EDGE_VOICE = 'en-US-MichelleNeural';
const DEFAULT_EDGE_LANG = 'en-US';
const DEFAULT_EDGE_OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

export function inferEdgeExtension(outputFormat: string): string {
  const normalized = outputFormat.toLowerCase();
  if (normalized.includes('webm')) return '.webm';
  if (normalized.includes('ogg')) return '.ogg';
  if (normalized.includes('opus')) return '.opus';
  if (normalized.includes('wav') || normalized.includes('riff') || normalized.includes('pcm')) return '.wav';
  return '.mp3';
}

export class EdgeProvider extends BaseTTSProvider {
  readonly name = 'edge';

  private voice: string;
  private lang: string;
  private outputFormat: string;
  private pitch?: string;
  private rate?: string;
  private volume?: string;
  private proxy?: string;

  constructor(config: EdgeProviderConfig = {}) {
    super(config);
    this.voice = config.voice || DEFAULT_EDGE_VOICE;
    this.lang = config.lang || DEFAULT_EDGE_LANG;
    this.outputFormat = config.outputFormat || DEFAULT_EDGE_OUTPUT_FORMAT;
    this.pitch = config.pitch;
    this.rate = config.rate;
    this.volume = config.volume;
    this.proxy = config.proxy;
  }

  isConfigured(): boolean {
    return true;
  }

  protected async doSpeak(text: string, options?: TTSOptions): Promise<TTSResult> {
    const { EdgeTTS } = await import('node-edge-tts');

    const voice = options?.voice || this.voice;
    const outputFormat = this.outputFormat;

    log.debug({ voice, outputFormat, textLength: text.length }, 'Calling Edge TTS');

    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');

    const tempDir = mkdtempSync(path.join(tmpdir(), 'tts-edge-'));
    const extension = inferEdgeExtension(outputFormat);
    const outputPath = path.join(tempDir, `speech-${Date.now()}${extension}`);

    try {
      const tts = new EdgeTTS({
        voice,
        lang: this.lang,
        outputFormat,
        proxy: this.proxy,
        rate: this.rate,
        pitch: this.pitch,
        volume: this.volume,
        timeout: this.config.timeoutMs,
      });

      await tts.ttsPromise(text, outputPath);

      const { readFileSync, rmSync } = await import('node:fs');
      const audioBuffer = readFileSync(outputPath);

      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        log.warn({ error: cleanupErr }, 'Failed to cleanup Edge TTS temp files');
      }

      let format: string;
      if (extension === '.opus') format = 'opus';
      else if (extension === '.wav') format = 'wav';
      else if (extension === '.webm') format = 'webm';
      else if (extension === '.ogg') format = 'ogg';
      else format = 'mp3';

      return {
        audio: audioBuffer,
        format,
        provider: this.name,
      };
    } catch (error) {
      try {
        const { rmSync } = await import('node:fs');
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }
}
