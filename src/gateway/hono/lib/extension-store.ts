import { DurableState } from '../../../storage/sqlite/durable-state.js';

const state = new DurableState<Record<string, unknown>>('extension-ui');

function validateNamespace(namespace: string): void {
  if (!namespace.trim()) throw new Error('Extension namespace is required');
}

export async function loadExtensionStore(namespace: string): Promise<Record<string, unknown>> {
  validateNamespace(namespace);
  return state.get(namespace) ?? {};
}

export async function saveExtensionStore(namespace: string, data: Record<string, unknown>): Promise<void> {
  validateNamespace(namespace);
  state.set(namespace, data);
}
