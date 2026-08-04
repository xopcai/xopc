/**
 * Shared provider HTTP barrel (voice, STT/TTS, image-generation extensions).
 * Capability modules import this surface; direct deep imports are discouraged.
 */

export {
  collectProviderApiKeysForExecution,
  executeWithApiKeyRotation,
  isRotatableAuthFailure,
  type ApiKeyRetryParams,
  type ExecuteWithApiKeyRotationOptions,
} from './api-key-rotation.js';

export {
  TimeoutAbortError,
  isTimeoutAbortError,
  pickEffectiveTimeoutMs,
  pickTimeoutMsOrFallback,
  resolveDeadline,
  type DeadlineInput,
  type ResolvedDeadline,
} from './deadline.js';

export {
  BlockedPrivateNetworkError,
  assertNotPrivateNetwork,
  classifyHost,
  defaultPolicy as defaultPrivateNetworkPolicy,
  privateNetworkPolicyToSsrfGuardOptions,
  type HostClass,
  type PrivateNetworkPolicy,
} from './private-network.js';

export {
  resolveProviderHttpRequestConfig,
  type ResolvedProviderHttpDefaults,
  type ResolveProviderHttpRequestConfigOptions,
} from './resolve-provider-http-request-config.js';

export {
  ProviderHttpError,
  assertOk,
  assertOkOrThrowHttpError,
  assertOkOrThrowProviderError,
  createProviderHttpError,
  extractProviderErrorDetail,
  extractProviderRequestId,
  extractVendorErrorFields,
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
  readJsonResponseLimited,
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
