/**
 * Speech provider extension contract validation.
 */

import { getSpeechProvider } from '../voice/tts/speech-registry.js';

import type { ExtensionLogger } from './types/core.js';
import type { ExtensionManifest } from './types/manifest.js';

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

/** Declared speech provider ids from manifest (top-level + contracts). */
export function declaredSpeechProviderIds(manifest: ExtensionManifest): string[] {
  const ids = new Set<string>();
  for (const id of manifest.speechProviders ?? []) {
    if (typeof id === 'string' && id.trim()) {
      ids.add(normalizeId(id));
    }
  }
  for (const id of manifest.contracts?.speechProviders ?? []) {
    if (typeof id === 'string' && id.trim()) {
      ids.add(normalizeId(id));
    }
  }
  return [...ids];
}

/** Registered ids normalized for comparison (includes canonical plugin ids). */
export function normalizeRegisteredSpeechProviderIds(registeredIds: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const id of registeredIds) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    normalized.add(normalizeId(trimmed));
    const canonical = getSpeechProvider(trimmed)?.id;
    if (canonical) {
      normalized.add(normalizeId(canonical));
    }
  }
  return [...normalized];
}

/**
 * Warn when a manifest declares speech provider contracts but the extension
 * did not register matching providers at load time.
 */
export function validateSpeechProviderContracts(params: {
  extensionId: string;
  manifest: ExtensionManifest;
  registeredProviderIds: readonly string[];
  logger: ExtensionLogger;
}): void {
  const declared = declaredSpeechProviderIds(params.manifest);
  if (declared.length === 0) {
    return;
  }

  const registered = new Set(normalizeRegisteredSpeechProviderIds(params.registeredProviderIds));

  for (const id of declared) {
    const plugin = getSpeechProvider(id);
    const canonical = plugin ? normalizeId(plugin.id) : id;
    if (!registered.has(canonical) && !registered.has(id)) {
      params.logger.warn(
        `Speech provider contract "${id}" declared in manifest but not registered by extension "${params.extensionId}"`,
      );
    }
  }
}
