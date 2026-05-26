/**
 * Groq STT extension — sample MediaUnderstandingProvider using the Phase 4 media SDK.
 *
 * Registers provider id `groq` against Groq's OpenAI-compatible Whisper endpoint.
 * Configure via:
 *   - env: GROQ_API_KEY
 *   - config: tools.media.audio.providers.groq.{apiKey,model,baseUrl}
 *
 * Ported from openclaw/extensions/groq/media-understanding-provider.ts (subset).
 */

import type { ExtensionDefinition } from '../../src/extensions/types/core.js';
import { createOpenAiCompatibleAudioProvider } from '../../src/media-understanding/openai-compatible-audio.js';

const DEFAULT_GROQ_AUDIO_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_GROQ_AUDIO_MODEL = 'whisper-large-v3-turbo';

export const groqSttProvider = createOpenAiCompatibleAudioProvider({
  id: 'groq',
  aliases: ['groq-whisper'],
  envKey: 'GROQ_API_KEY',
  defaultBaseUrl: DEFAULT_GROQ_AUDIO_BASE_URL,
  defaultModel: DEFAULT_GROQ_AUDIO_MODEL,
  autoPriority: 15,
  label: 'Groq STT',
});

const extension: ExtensionDefinition = {
  id: 'groq-stt',
  name: 'Groq STT',
  description: 'Groq Whisper speech-to-text via OpenAI-compatible /audio/transcriptions.',
  kind: 'media-provider',
  register(api) {
    api.registerMediaUnderstandingProvider(groqSttProvider);
  },
};

export default extension;
