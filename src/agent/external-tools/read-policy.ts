import type { ExternalToolProvider } from './types.js';

/** Only local configuration and host-curated contracts may authorize delegated reads. */
export function withExternalReadPolicy(provider: ExternalToolProvider,
  getPolicy: (toolRef: string) => { mode: string; readOnly?: boolean } | undefined,
): ExternalToolProvider {
  return {
    source: provider.source,
    search: (query, context) => context ? provider.search(query, context) : provider.search(query),
    ...(provider.connectionCandidates ? { connectionCandidates: provider.connectionCandidates.bind(provider) } : {}),
    describe: async (ref, context) => {
      const descriptor = await (context ? provider.describe(ref, context) : provider.describe(ref));
      if (!descriptor) return undefined;
      const policy = getPolicy(ref);
      if (policy?.mode === 'deny') return undefined;
      // Batch eligibility cannot promote an operation the provider classifies as a write.
      const batchRead = descriptor.readOnly === false ? false : provider.source === 'endpoint'
        ? descriptor.batchRead === true && policy?.readOnly !== false
        : policy?.readOnly ?? descriptor.batchRead;
      return { ...descriptor, batchRead };
    },
    execute: (ref, args, approval, context) => provider.execute(ref, args, approval, context),
  };
}
