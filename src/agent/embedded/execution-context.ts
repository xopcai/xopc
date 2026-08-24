import { AsyncLocalStorage } from 'node:async_hooks';

const executionSessionStorage = new AsyncLocalStorage<string>();

export function runWithEmbeddedExecutionSession<T>(sessionKey: string, run: () => T): T {
  return executionSessionStorage.run(sessionKey, run);
}

export function getEmbeddedExecutionSession(): string | undefined {
  return executionSessionStorage.getStore();
}
