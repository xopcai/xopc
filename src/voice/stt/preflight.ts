import type { STTConfig, STTResult } from './types.js';
import { transcribe } from './transcribe-core.js';
import { isSTTAvailable } from './availability.js';
export { checkMentionInTranscription } from './mention.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('STT:Preflight');

export interface AudioPreflightInput {
  audioBuffer: Buffer;
  mimeType?: string;
  sttConfig: STTConfig;
  language?: string;
}

export interface AudioPreflightResult {
  success: boolean;
  transcribedText?: string;
  provider?: string;
  duration?: number;
  error?: string;
}

/**
 * Transcribe audio before mention routing (e.g. group voice → detect spoken @bot).
 */
export async function audioPreflightTranscribe(
  input: AudioPreflightInput,
): Promise<AudioPreflightResult> {
  const { audioBuffer, sttConfig, language } = input;

  if (!isSTTAvailable(sttConfig)) {
    log.debug('STT not available, skipping preflight');
    return { success: false, error: 'STT not available' };
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    return { success: false, error: 'Empty audio buffer' };
  }

  const startTime = Date.now();

  try {
    const result: STTResult = await transcribe(audioBuffer, sttConfig, {
      language,
    });

    const duration = (Date.now() - startTime) / 1000;

    if (!result.text?.trim()) {
      log.debug({ duration }, 'Preflight transcription returned empty text');
      return {
        success: false,
        provider: result.provider,
        duration,
        error: 'Empty transcription result',
      };
    }

    log.info(
      {
        provider: result.provider,
        textLength: result.text.length,
        duration,
      },
      'Audio preflight transcription completed',
    );

    return {
      success: true,
      transcribedText: result.text,
      provider: result.provider,
      duration,
    };
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    const errorMsg = error instanceof Error ? error.message : String(error);

    log.warn({ errorMessage: errorMsg, duration }, 'Audio preflight transcription failed');

    return {
      success: false,
      duration,
      error: errorMsg,
    };
  }
}

