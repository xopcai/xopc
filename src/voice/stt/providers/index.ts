/**
 * STT provider barrel.
 *
 * Each `*-transcription.ts` module self-registers into the media-understanding
 * registry at import time (`registerMediaUnderstandingProvider`). Importing
 * this barrel is the canonical way to ensure all built-in STT providers are
 * registered before `resolveSTTProviderChain` looks them up.
 *
 * The registry lives in `src/media-understanding/registry.ts` (same role as
 * `speech-registry.ts` for TTS). Direct imports of the exported provider objects
 * bypass discoverability of registry overrides from extensions.
 */

export { openAiTranscriptionProvider } from './openai-transcription.js';
export { alibabaTranscriptionProvider } from './alibaba-transcription.js';
