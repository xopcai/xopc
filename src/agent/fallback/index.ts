export type { FailoverReason } from './reason.js';
export {
  classifyFailoverReason,
  isRateLimitErrorMessage,
  isTimeoutErrorMessage,
  isBillingErrorMessage,
  isAuthErrorMessage,
  isFormatErrorMessage,
} from './reason.js';

export { FailoverError, isFailoverError, describeFailoverError } from './error.js';

export { runWithModelFallback, type FallbackResult } from './runner.js';
export type { ModelCandidate, FallbackAttempt } from './candidates.js';
export { resolveFallbackCandidates, isProviderConfigured } from './candidates.js';
