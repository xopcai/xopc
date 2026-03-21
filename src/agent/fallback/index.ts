export type { FailoverReason } from './reason.js';

export { FailoverError, isFailoverError, describeFailoverError } from './error.js';

export type { ModelCandidate, FallbackAttempt } from './candidates.js';
export { resolveFallbackCandidates } from './candidates.js';
export { isProviderConfiguredSync as isProviderConfigured } from '../../providers/index.js';
