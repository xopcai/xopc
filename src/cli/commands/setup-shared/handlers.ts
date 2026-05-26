/**
 * Setup handler registry.
 *
 * Each setup CLI command file registers one entry per `(domain, action)` it
 * implements. The gateway HTTP route (`POST /api/setup/:domain/:action`) and
 * any other non-CLI caller looks up the handler by id and invokes it with
 * an opaque `fields` object — the handler is responsible for parsing those
 * fields into the shape its mutator needs and calling
 * {@link runSetupHeadless}.
 *
 * Registration is a side effect of importing the command module. The gateway
 * forces all CLI command modules to load at boot (via the same lazy-loader
 * map used by `xopc setup manifest`) so every handler is reachable without
 * requiring the CLI itself to run.
 */

import type { SetupOutcome, SetupRunOptions } from './types.js';

export interface SetupHandlerArgs {
  configPath: string;
  /** Action-specific fields parsed from the HTTP body (or other caller). */
  fields: Record<string, unknown>;
  options: SetupRunOptions;
}

export type SetupHandler = (args: SetupHandlerArgs) => Promise<SetupOutcome>;

export interface SetupHandlerEntry {
  domain: string;
  action: string;
  handler: SetupHandler;
}

const REGISTRY = new Map<string, SetupHandlerEntry>();

function key(domain: string, action: string): string {
  return `${domain}::${action}`;
}

export function registerSetupHandler(entry: SetupHandlerEntry): void {
  REGISTRY.set(key(entry.domain, entry.action), entry);
}

export function getSetupHandler(domain: string, action: string): SetupHandlerEntry | undefined {
  return REGISTRY.get(key(domain, action));
}

export function listSetupHandlers(): SetupHandlerEntry[] {
  return Array.from(REGISTRY.values()).sort((a, b) => {
    const dc = a.domain.localeCompare(b.domain);
    return dc !== 0 ? dc : a.action.localeCompare(b.action);
  });
}
