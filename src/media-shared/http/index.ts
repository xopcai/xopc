/**
 * Public surface of the media-shared HTTP layer.
 * Voice (TTS) and media-understanding (STT/image/video) providers depend on
 * this barrel. Direct deep imports are discouraged.
 */

export {
  collectProviderApiKeysForExecution,
  executeWithApiKeyRotation,
  isRotatableAuthFailure,
  type ApiKeyRetryParams,
  type ExecuteWithApiKeyRotationOptions,
} from './api-key-rotation.js';

export {
  ProviderHttpError,
  assertOkOrThrowHttpError,
  assertOkOrThrowProviderError,
  createProviderHttpError,
  extractProviderErrorDetail,
  extractProviderRequestId,
  formatProviderErrorPayload,
  formatProviderHttpErrorMessage,
  readResponseTextLimited,
  truncateErrorDetail,
  type ProviderHttpErrorParts,
} from './provider-http-errors.js';

export {
  createProviderOperationDeadline,
  fetchWithTimeoutGuarded,
  getJsonRequest,
  normalizeBaseUrl,
  postJsonRequest,
  postMultipartRequest,
  waitProviderOperationPollInterval,
  type FetchWithGuardOptions,
  type GetJsonRequestOptions,
  type PostJsonRequestOptions,
  type PostMultipartRequestOptions,
  type ProviderHttpRequestConfig,
  type ProviderOperationDeadline,
} from './provider-http.js';

export {
  SsrfBlockedError,
  assertSafeUrl,
  isPrivateIpAddress,
  isPrivateIpv4,
  isPrivateIpv6,
  type ResolvedSsrfTarget,
  type SsrfGuardOptions,
} from './ssrf-guard.js';
