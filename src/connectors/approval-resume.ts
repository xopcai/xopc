import { randomUUID } from 'node:crypto';
import { getActiveConnectionWait } from '../storage/sqlite/connection-wait-repository.js';
import type { ConnectorApprovalRecord } from './types.js';
import type { ConnectionRecoveryService } from './connection-recovery-service.js';

/** Approval resumes only the exact suspended objective that requested it. */
export async function resumeApprovedConnectorAction(approval: ConnectorApprovalRecord, recovery: ConnectionRecoveryService): Promise<boolean> {
  if (approval.status !== 'approved' || !approval.waitId || !approval.conversationId) return false;
  const wait = getActiveConnectionWait(approval.conversationId);
  if (!wait || wait.id !== approval.waitId || wait.principalId !== approval.principalId || wait.agentId !== approval.agentId || wait.status !== 'open') return false;
  try {
    const result = await recovery.act(wait.conversationId, { action: 'continue', waitId: wait.id, expectedTranscriptId: wait.transcriptId,
      expectedVersion: wait.version, idempotencyKey: randomUUID() });
    return result.snapshot.wait?.phase === 'queued';
  } catch { return false; }
}
