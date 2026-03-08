export type { FailoverReason } from './reason.js';

export { FailoverError, isFailoverError, describeFailoverError } from './error.js';

export type { ModelCandidate, FallbackAttempt } from './candidates.js';
export { resolveFallbackCandidates, isProviderConfigured } from './candidates.js';
