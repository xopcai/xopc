import { AsyncLocalStorage } from 'node:async_hooks';

type EmbeddedExecutionContext = { sessionKey: string; runId?: string };

const executionSessionStorage = new AsyncLocalStorage<EmbeddedExecutionContext>();

export function runWithEmbeddedExecutionSession<T>(
  sessionKey: string,
  run: () => T,
  runId?: string,
): T {
  return executionSessionStorage.run({ sessionKey, runId }, run);
}

export function getEmbeddedExecutionSession(): string | undefined {
  return executionSessionStorage.getStore()?.sessionKey;
}

export function getEmbeddedExecutionRunId(): string | undefined {
  return executionSessionStorage.getStore()?.runId;
}
