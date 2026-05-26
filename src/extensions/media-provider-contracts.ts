/**
 * Media understanding (STT / image / video) extension contract validation.
 */

import { getMediaUnderstandingProvider } from '../media-understanding/registry.js';

import type { ExtensionLogger } from './types/core.js';
import type { ExtensionManifest } from './types/manifest.js';

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

/** Declared media understanding provider ids from manifest (top-level + contracts). */
export function declaredMediaUnderstandingProviderIds(manifest: ExtensionManifest): string[] {
  const ids = new Set<string>();
  for (const id of manifest.mediaUnderstandingProviders ?? []) {
    if (typeof id === 'string' && id.trim()) {
      ids.add(normalizeId(id));
    }
  }
  for (const id of manifest.contracts?.mediaUnderstandingProviders ?? []) {
    if (typeof id === 'string' && id.trim()) {
      ids.add(normalizeId(id));
    }
  }
  return [...ids];
}

/** Registered ids normalized for comparison (includes canonical plugin ids). */
export function normalizeRegisteredMediaUnderstandingProviderIds(
  registeredIds: readonly string[],
): string[] {
  const normalized = new Set<string>();
  for (const id of registeredIds) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    normalized.add(normalizeId(trimmed));
    const canonical = getMediaUnderstandingProvider(trimmed)?.id;
    if (canonical) {
      normalized.add(normalizeId(canonical));
    }
  }
  return [...normalized];
}

/**
 * Warn when a manifest declares media understanding contracts but the extension
 * did not register matching providers at load time.
 */
export function validateMediaUnderstandingProviderContracts(params: {
  extensionId: string;
  manifest: ExtensionManifest;
  registeredProviderIds: readonly string[];
  logger: ExtensionLogger;
}): void {
  const declared = declaredMediaUnderstandingProviderIds(params.manifest);
  if (declared.length === 0) {
    return;
  }

  const registered = new Set(
    normalizeRegisteredMediaUnderstandingProviderIds(params.registeredProviderIds),
  );

  for (const id of declared) {
    const plugin = getMediaUnderstandingProvider(id);
    const canonical = plugin ? normalizeId(plugin.id) : id;
    if (!registered.has(canonical) && !registered.has(id)) {
      params.logger.warn(
        `Media understanding provider contract "${id}" declared in manifest but not registered by extension "${params.extensionId}"`,
      );
    }
  }
}
