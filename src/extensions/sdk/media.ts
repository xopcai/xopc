/**
 * Media understanding (STT / image / video) extension SDK.
 *
 * Extensions import `@xopcai/xopc/extension-sdk/media` for a stable surface to
 * register MediaUnderstandingProvider plugins and reuse OpenAI-compatible STT helpers.
 */

export type {
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
  MediaCapability,
  MediaUnderstandingModelEntry,
  MediaUnderstandingProvider,
} from '../../media-understanding/types.js';

export {
  getMediaUnderstandingProvider,
  listMediaUnderstandingProviders,
  registerMediaUnderstandingProvider,
} from '../../media-understanding/registry.js';

export {
  buildAudioTranscriptionFormData,
  createOpenAiCompatibleAudioProvider,
  registerOpenAiCompatibleAudioProvider,
  resolveAudioTranscriptionUploadFileName,
  transcribeOpenAiCompatibleAudio,
  type OpenAiCompatibleAudioProviderOptions,
} from '../../media-understanding/openai-compatible-audio.js';

export {
  ProviderHttpError,
  assertOkOrThrowHttpError,
  fetchWithTimeoutGuarded,
  normalizeBaseUrl,
  postMultipartRequest,
  SsrfBlockedError,
  assertSafeUrl,
} from '../../media-shared/http/index.js';

export type {
  FetchWithGuardOptions,
  PostMultipartRequestOptions,
  ProviderHttpErrorParts,
  ProviderHttpRequestConfig,
} from '../../media-shared/http/index.js';
