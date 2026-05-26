/**
 * Resolve configured media model entries for a capability.
 *
 * Ported subset of openclaw/src/media-understanding/resolve.ts (`resolveModelEntries`).
 */

import { listMediaUnderstandingProviders } from './registry.js';
import type { MediaCapability, MediaUnderstandingModelEntry } from './types.js';

export function resolveModelEntries(params: {
  capability: MediaCapability;
  capabilityModels?: readonly MediaUnderstandingModelEntry[];
  sharedModels?: readonly MediaUnderstandingModelEntry[];
}): MediaUnderstandingModelEntry[] {
  const registry = new Map(
    listMediaUnderstandingProviders().map((provider) => [provider.id.toLowerCase(), provider]),
  );

  const entries = [
    ...(params.capabilityModels ?? []).map((entry) => ({ entry, source: 'capability' as const })),
    ...(params.sharedModels ?? []).map((entry) => ({ entry, source: 'shared' as const })),
  ];
  if (entries.length === 0) {
    return [];
  }

  return entries
    .filter(({ entry, source }) => {
      if (entry.type === 'cli') {
        return false;
      }
      const providerId = entry.provider?.trim().toLowerCase();
      if (!providerId && !entry.command) {
        return source === 'capability';
      }
      const caps = entry.capabilities;
      if (!caps || caps.length === 0) {
        if (source === 'shared') {
          return false;
        }
        return true;
      }
      if (!caps.includes(params.capability)) {
        return false;
      }
      if (providerId && !registry.has(providerId)) {
        return source === 'capability';
      }
      return true;
    })
    .map(({ entry }) => entry);
}
