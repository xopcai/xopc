import { larkAdapter } from './adapters/lark.js';
import { wecomAdapter } from './adapters/wecom.js';
import type { CliAdapter } from './types.js';

const adapters = new Map<string, CliAdapter>([larkAdapter, wecomAdapter].map(adapter => [adapter.id, adapter]));

export function getCliAdapter(id: string): CliAdapter {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`Unknown CLI adapter: ${id}`);
  return adapter;
}

/** Register a trusted packaged protocol adapter; manifests cannot supply executable code. */
export function registerCliAdapter(adapter: CliAdapter): void {
  if (!/^[a-z][a-z0-9-]*$/.test(adapter.id) || adapters.has(adapter.id)) throw new Error('Invalid or duplicate CLI adapter.');
  if (![adapter.version, adapter.binaryVersion, adapter.executable].every(value => /^[a-zA-Z0-9_.-]+$/.test(value) && value !== '..')) throw new Error('Invalid CLI adapter version or executable.');
  adapters.set(adapter.id, adapter);
}
