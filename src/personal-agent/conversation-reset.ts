import { abortEmbeddedRun } from '../agent/embedded/runs.js';
import { evictEmbeddedSessionRunner } from '../agent/embedded/session-runner.js';
import { cancelPhoneAssistance } from '../phone/assistance.js';
import { getPhoneRuntime } from '../phone/runtime.js';
import type { SessionIndex } from '../session/index.js';
import { emitSessionTranscriptUpdate } from '../session/transcript-events.js';
import { deleteBrowserTabBinding } from '../storage/sqlite/browser-tab-binding-repository.js';
import { getSessionMetadata } from '../storage/sqlite/session-repository.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';
import { getPersonalAgent } from './repository.js';

const log = createLogger('PersonalConversationReset');
const inFlightResets = new Set<string>();

export type PersonalConversationResetHost = {
  sessionIndexInstance: Pick<SessionIndex, 'resetSession'>;
  agentService?: {
    evictSessionAgent(conversationId: string): void;
    cancelConfigurationSetups?(conversationId: string): Promise<void>;
  };
  voiceRealtime?: { hasConversation(conversationId: string): boolean };
  withSessionInputSubmission?<T>(conversationId: string, operation: () => Promise<T>): Promise<T>;
  emit?(type: string, payload?: unknown): void;
};

export type PersonalConversationResetResult =
  | { ok: true; conversationId: string; transcriptId: string; previousTranscriptId?: string }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Archive the active Personal Agent transcript and start a fresh transcript on the
 * same conversationId, keeping model overrides, schedules, user memory, and tasks.
 */
export async function resetPersonalConversation(
  service: PersonalConversationResetHost,
  ownerId: string,
  options?: { expectedTranscriptId?: string },
): Promise<PersonalConversationResetResult> {
  if (inFlightResets.has(ownerId)) {
    return { ok: false, status: 409, error: 'A conversation reset is already in progress' };
  }
  const initial = getPersonalAgent(ownerId);
  if (!initial || initial.state !== 'ready') {
    return { ok: false, status: 409, error: 'Personal Agent is unavailable' };
  }
  const conversationId = initial.conversationId;
  if (service.voiceRealtime?.hasConversation(conversationId)) {
    return { ok: false, status: 409, error: 'End the voice call before starting a new conversation' };
  }

  inFlightResets.add(ownerId);
  try {
    const execute = async (): Promise<PersonalConversationResetResult> => {
      const current = getPersonalAgent(ownerId);
      if (!current || current.state !== 'ready' || current.conversationId !== conversationId) {
        return { ok: false, status: 409, error: 'Personal Agent is unavailable' };
      }
      if (service.voiceRealtime?.hasConversation(conversationId)) {
        return { ok: false, status: 409, error: 'End the voice call before starting a new conversation' };
      }
      const session = getSessionMetadata(conversationId);
      if (!session) {
        return { ok: false, status: 404, error: 'Conversation not found' };
      }
      if (options?.expectedTranscriptId && session.transcriptId !== options.expectedTranscriptId) {
        return { ok: false, status: 409, error: 'Conversation changed. Reload and try again.' };
      }

      await abortEmbeddedRun(conversationId);

      try {
        await service.agentService?.cancelConfigurationSetups?.(conversationId);
        cancelPhoneAssistance(conversationId);
        await getPhoneRuntime().stop(conversationId, 'close');
      } catch (err) {
        log.warn({ err, ownerId, conversationId, phase: 'setup_release' }, 'Configuration test release is unconfirmed');
        return {
          ok: false,
          status: 409,
          error: 'Configuration test control could not be released. Recheck the device and retry.',
        };
      }

      const reset = await service.sessionIndexInstance.resetSession(conversationId);
      if (!reset) {
        return { ok: false, status: 404, error: 'Conversation not found' };
      }

      runSqliteWriteTransaction((db) => {
        const now = Date.now();
        db.prepare(`UPDATE sessions
          SET custom_data_json = json_remove(COALESCE(custom_data_json, '{}'), '$.personalRead')
          WHERE conversation_id = ?`).run(conversationId);
        db.prepare(`UPDATE personal_attention_threads
          SET status = 'expired',
              terminal_reason = CASE WHEN follow_up_mode = 'one_shot' THEN 'conversation_reset' ELSE terminal_reason END,
              next_check_at = NULL,
              revision = revision + 1,
              updated_at = ?
          WHERE conversation_id = ? AND status IN ('candidate', 'active', 'paused')`).run(now, conversationId);
        db.prepare(`UPDATE personal_wakeups
          SET status = 'cancelled', lease_until = 0
          WHERE thread_id IN (SELECT id FROM personal_attention_threads WHERE conversation_id = ?)
            AND status IN ('pending', 'evaluating')`).run(conversationId);
        db.prepare(`UPDATE personal_outreach
          SET state = 'stale', text = NULL
          WHERE conversation_id = ? AND state IN ('decided', 'ready')`).run(conversationId);
      });
      deleteBrowserTabBinding(conversationId);

      evictEmbeddedSessionRunner(conversationId, 'personal_conversation_reset');
      try {
        service.agentService?.evictSessionAgent(conversationId);
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        log.warn({ err, ownerId, conversationId, errorMessage: em }, `Personal conversation reset runtime cleanup failed: ${em}`);
      }

      emitSessionTranscriptUpdate({ conversationId });
      service.emit?.('session.transcript_updated', { key: conversationId });
      service.emit?.('personal.unread.updated', { conversationId });

      log.info(
        { ownerId, conversationId, transcriptId: reset.transcriptId, previousTranscriptId: reset.previousTranscriptId },
        'Personal conversation reset completed',
      );

      return {
        ok: true,
        conversationId,
        transcriptId: reset.transcriptId,
        previousTranscriptId: reset.previousTranscriptId,
      };
    };

    return service.withSessionInputSubmission
      ? await service.withSessionInputSubmission(conversationId, execute)
      : await execute();
  } finally {
    inFlightResets.delete(ownerId);
  }
}
