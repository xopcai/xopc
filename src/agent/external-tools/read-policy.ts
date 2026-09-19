import type { ExternalToolProvider } from './types.js';

/** Only local configuration and host-curated contracts may authorize delegated reads. */
export function withExternalReadPolicy(provider: ExternalToolProvider,
  getPolicy: (toolRef: string) => { mode: string; readOnly?: boolean } | undefined,
): ExternalToolProvider {
  return {
    source: provider.source,
    search: query => provider.search(query),
    describe: async ref => {
      const descriptor = await provider.describe(ref);
      if (!descriptor) return undefined;
      const policy = getPolicy(ref);
      if (policy?.mode === 'deny') return undefined;
      return { ...descriptor, batchRead: policy?.readOnly ?? descriptor.batchRead };
    },
    execute: (ref, args, approval, context) => provider.execute(ref, args, approval, context),
  };
}
