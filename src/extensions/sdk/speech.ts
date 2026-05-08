/**
 * Speech provider extension SDK.
 *
 * Re-exports the SpeechProviderPlugin contract + registration helpers + the
 * media-shared HTTP client so extension authors have a stable, single-import
 * surface.
 *
 * DECISION: This module mirrors the channel SDK pattern at
 * `src/extensions/sdk/channel.ts` — extensions import `@xopcai/xopc/extension-sdk/speech`
 * (resolved via the package.json `exports` map) and never reach into deep paths.
 *
 * What lives here:
 *   - SpeechProviderPlugin contract types
 *   - registerSpeechProvider / getSpeechProvider / listSpeechProviders
 *   - createOpenAiCompatibleSpeechProvider factory (most providers reuse it)
 *   - HTTP helpers (postJsonRequest, fetchWithTimeoutGuarded, ProviderHttpError, ...)
 *   - SSRF guard (assertSafeUrl, SsrfBlockedError)
 *   - API key rotation (executeWithApiKeyRotation)
 *
 * What does NOT live here (deliberately): config schema types, agent service,
 * channel internals — those are channel-SDK / core-SDK responsibilities.
 */

export type {
  SpeechDirectiveTokenParseContext,
  SpeechDirectiveTokenParseResult,
  SpeechListVoicesRequest,
  SpeechModelOverridePolicy,
  SpeechProviderConfig,
  SpeechProviderConfiguredContext,
  SpeechProviderId,
  SpeechProviderOverrides,
  SpeechProviderPlugin,
  SpeechProviderResolveConfigContext,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
  SpeechSynthesisStreamRequest,
  SpeechSynthesisStreamResult,
  SpeechSynthesisTarget,
  SpeechVoiceOption,
} from '../../voice/tts/speech-provider-types.js';

export {
  canonicalizeSpeechProviderId,
  getSpeechProvider,
  listSpeechProviders,
  registerSpeechProvider,
} from '../../voice/tts/speech-registry.js';

export {
  // Key rotation
  collectProviderApiKeysForExecution,
  executeWithApiKeyRotation,
  isRotatableAuthFailure,
  // HTTP errors
  ProviderHttpError,
  assertOkOrThrowHttpError,
  assertOkOrThrowProviderError,
  createProviderHttpError,
  extractProviderErrorDetail,
  extractProviderRequestId,
  // HTTP client
  createProviderOperationDeadline,
  fetchWithTimeoutGuarded,
  getJsonRequest,
  normalizeBaseUrl,
  postJsonRequest,
  postMultipartRequest,
  waitProviderOperationPollInterval,
  // SSRF guard
  SsrfBlockedError,
  assertSafeUrl,
  isPrivateIpAddress,
} from '../../media-shared/http/index.js';

export type {
  ApiKeyRetryParams,
  ExecuteWithApiKeyRotationOptions,
  FetchWithGuardOptions,
  GetJsonRequestOptions,
  PostJsonRequestOptions,
  PostMultipartRequestOptions,
  ProviderHttpErrorParts,
  ProviderHttpRequestConfig,
  ProviderOperationDeadline,
  ResolvedSsrfTarget,
  SsrfGuardOptions,
} from '../../media-shared/http/index.js';
