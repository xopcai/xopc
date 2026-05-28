/**
 * Dynamic marketplace adapter registry.
 *
 * Built-in adapters (store, skillhub, clawhub) self-register at import time.
 * Extensions call `registerMarketplaceAdapter` to add third-party sources.
 */

import type { SkillsMarketplaceAdapter } from './adapter.types.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('MarketplaceRegistry');

/** Central adapter map — keyed by adapter id (lowercase). */
const adapters = new Map<string, SkillsMarketplaceAdapter>();

/** Display-name overrides set via `registerMarketplaceAdapter`. */
const displayNames = new Map<string, string>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MarketplaceAdapterRegistration {
  adapter: SkillsMarketplaceAdapter;
  /** Human-readable label shown in the UI provider picker (e.g. "ClawHub (clawhub.ai)"). */
  displayName?: string;
}

/**
 * Register (or replace) a marketplace adapter.
 * Built-in adapters call this at module scope; extensions call it from
 * `api.registerMarketplaceAdapter()`.
 */
export function registerMarketplaceAdapter(registration: MarketplaceAdapterRegistration): void {
  const { adapter, displayName } = registration;
  const id = adapter.id;
  if (adapters.has(id)) {
    log.info({ adapterId: id }, `Replacing marketplace adapter: ${id}`);
  } else {
    log.info({ adapterId: id }, `Registered marketplace adapter: ${id}`);
  }
  adapters.set(id, adapter);
  if (displayName) {
    displayNames.set(id, displayName);
  }
}

/** Remove a marketplace adapter (e.g. when an extension is unloaded). */
export function unregisterMarketplaceAdapter(id: string): boolean {
  const removed = adapters.delete(id);
  if (removed) {
    displayNames.delete(id);
    log.info({ adapterId: id }, `Unregistered marketplace adapter: ${id}`);
  }
  return removed;
}

/** Get an adapter by id. Returns `undefined` when not registered. */
export function getRegisteredAdapter(id: string): SkillsMarketplaceAdapter | undefined {
  return adapters.get(id);
}

/** All registered adapter ids (insertion order). */
export function getRegisteredAdapterIds(): string[] {
  return [...adapters.keys()];
}

/** Provider info list for the UI provider picker. */
export function listRegisteredProviders(): Array<{ id: string; displayName: string }> {
  return [...adapters.entries()].map(([id, adapter]) => ({
    id,
    displayName: displayNames.get(id) ?? adapter.id,
  }));
}

/** Display name for a given provider id. */
export function getProviderDisplayName(id: string): string {
  return displayNames.get(id) ?? id;
}

/** Check whether a provider id is currently registered. */
export function isRegisteredProvider(id: string): boolean {
  return adapters.has(id);
}
