import type { AgentSession } from '@earendil-works/pi-coding-agent';

export type EmbeddedRunHandle = {
  sessionKey: string;
  sessionId: string;
  runId: string;
  session: AgentSession;
  abort: () => Promise<void>;
};

const activeBySessionKey = new Map<string, EmbeddedRunHandle>();
const activeByRunId = new Map<string, EmbeddedRunHandle>();

export function registerEmbeddedRun(handle: EmbeddedRunHandle): void {
  activeBySessionKey.set(handle.sessionKey, handle);
  activeByRunId.set(handle.runId, handle);
}

export function unregisterEmbeddedRun(handle: EmbeddedRunHandle): void {
  const cur = activeBySessionKey.get(handle.sessionKey);
  if (cur === handle) {
    activeBySessionKey.delete(handle.sessionKey);
  }
  activeByRunId.delete(handle.runId);
}

export function getEmbeddedRunBySessionKey(sessionKey: string): EmbeddedRunHandle | undefined {
  return activeBySessionKey.get(sessionKey);
}

export function getEmbeddedRunByRunId(runId: string): EmbeddedRunHandle | undefined {
  return activeByRunId.get(runId);
}

export async function abortEmbeddedRun(sessionKey: string): Promise<boolean> {
  const handle = activeBySessionKey.get(sessionKey);
  if (!handle) {
    return false;
  }
  await handle.abort();
  return true;
}

export async function queueEmbeddedSteer(sessionKey: string, text: string): Promise<boolean> {
  const handle = activeBySessionKey.get(sessionKey);
  if (!handle) {
    return false;
  }
  await handle.session.steer(text);
  return true;
}
