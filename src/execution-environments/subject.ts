import { isXopcDatabaseOpen } from '../storage/sqlite/index.js';
import { ExecutionEnvironmentStore } from './store.js';
import type { ExecutionEnvironment } from './types.js';

export function getExecutionEnvironmentForSession(sessionKey: string): ExecutionEnvironment | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const store = new ExecutionEnvironmentStore();
  const binding = store.resolveBinding(sessionKey);
  return binding ? store.get(binding.environmentId) : undefined;
}
