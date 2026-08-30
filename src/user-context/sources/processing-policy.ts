import type { UnderstandingSourceProcessingPolicy } from './types.js';

export function allowsRemoteSourceProcessing(
  policies: Iterable<UnderstandingSourceProcessingPolicy>,
): boolean {
  for (const policy of policies) if (policy !== 'remote_allowed') return false;
  return true;
}
