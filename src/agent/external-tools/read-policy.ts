import type { ExternalToolProvider, ExternalToolDescriptor } from './types.js';

/** Only local configuration and host-curated contracts may authorize delegated reads. */
export function withExternalReadPolicy(provider: ExternalToolProvider,
  getPolicy: (toolRef: string) => { mode: string; readOnly?: boolean } | undefined,
): ExternalToolProvider {
  const applyPolicy = (ref: string, descriptor: ExternalToolDescriptor) => {
    const policy = getPolicy(ref);
    if (policy?.mode === 'deny') return undefined;
    // Batch eligibility cannot promote an operation the provider classifies as a write.
    const batchRead = descriptor.readOnly === false ? false : provider.source === 'endpoint'
      ? descriptor.batchRead === true && policy?.readOnly !== false
      : policy?.readOnly ?? descriptor.batchRead;
    return { ...descriptor, batchRead };
  };
  return {
    source: provider.source,
    search: (query, context) => context ? provider.search(query, context) : provider.search(query),
    ...(provider.connectionCandidates ? { connectionCandidates: provider.connectionCandidates.bind(provider) } : {}),
    ...(provider.catalog ? { catalog: async () => (await provider.catalog!()).flatMap(descriptor => {
      const toolRef = descriptor.toolRef;
      const result = applyPolicy(toolRef, descriptor);
      return result ? [result] : [];
    }) } : {}),
    describe: async (ref, context) => {
      const descriptor = await (context ? provider.describe(ref, context) : provider.describe(ref));
      return descriptor ? applyPolicy(ref, descriptor) : undefined;
    },
    execute: (ref, args, approval, context) => provider.execute(ref, args, approval, context),
  };
}
