import { AsyncLocalStorage } from 'node:async_hooks';

type EmbeddedExecutionContext = { conversationId: string; runId?: string };

const executionSessionStorage = new AsyncLocalStorage<EmbeddedExecutionContext>();

export function runWithEmbeddedExecutionSession<T>(
  conversationId: string,
  run: () => T,
  runId?: string,
): T {
  return executionSessionStorage.run({ conversationId, runId }, run);
}

export function getEmbeddedExecutionSession(): string | undefined {
  return executionSessionStorage.getStore()?.conversationId;
}

export function getEmbeddedExecutionRunId(): string | undefined {
  return executionSessionStorage.getStore()?.runId;
}
