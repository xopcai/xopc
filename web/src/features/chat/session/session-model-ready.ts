import type { ChatSessionSlice } from './chat-session-store';

/** Draft configuration is local; only materialized sessions require a server revision. */
export function isSessionModelReady(
  session: Pick<ChatSessionSlice, 'model' | 'configVersion' | 'localDraft'> | undefined,
  models: readonly { id: string }[] | undefined,
): boolean {
  return Boolean(session && (session.localDraft || session.configVersion !== undefined)
    && models?.some(model => model.id === session.model));
}
