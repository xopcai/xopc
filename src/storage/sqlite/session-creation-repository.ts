import { createHash, randomUUID } from 'node:crypto';

import { sessionCommandIdentity, type SessionCreation, type SessionInputCommand, type SessionMaterializeCommand, type SessionPreparationState } from '@xopcai/gateway-contract';

import type { SessionAgentConfig } from '../../session/config-types.js';
import { createConversation } from './conversation-repository.js';
import { setSessionConfig } from './config-repository.js';
import { getSessionMetadata } from './session-repository.js';
import { insertSessionInput } from './session-input-repository.js';
import { invalidateConnectionResumeIntent } from './connection-wait-repository.js';
import { supersedeActiveClarification } from './clarification-wait-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export class SessionCommandError extends Error {
  constructor(readonly code: 'IDEMPOTENCY_CONFLICT' | 'CONVERSATION_EXISTS' | 'SESSION_DELETED' | 'FORBIDDEN' | 'SESSION_CHANGED' | 'CONFIG_CHANGED' | 'NOT_FOUND' | 'BAD_REQUEST' | 'SESSION_BUSY' | 'QUEUE_FULL', message: string) {
    super(message);
  }
}

export type SessionInputReceipt = {
  conversationId: string; clientMessageId: string; principalId: string; requestHash: string;
  inputId: string | null; transcriptId: string; acceptedAt: number;
};

export type SessionPreparation = {
  conversationId: string; operationId: string; creation: SessionCreation; state: SessionPreparationState;
  environmentId: string; baseCommit: string | null; revision: number; leaseUntil: number; lastError: string | null;
};

export function sessionCommandHash(command: SessionInputCommand | SessionMaterializeCommand): string {
  return createHash('sha256').update(sessionCommandIdentity(command)).digest('hex');
}

export function isConversationDeleted(conversationId: string): boolean {
  return Boolean(getSqliteDatabase().prepare('SELECT 1 FROM session_tombstones WHERE conversation_id=?').get(conversationId));
}

export function getSessionInputReceipt(conversationId: string, clientMessageId: string, principalId: string): SessionInputReceipt | undefined {
  const row = getSqliteDatabase().prepare(`SELECT conversation_id AS conversationId, client_message_id AS clientMessageId,
    principal_id AS principalId, request_hash AS requestHash, input_id AS inputId,
    transcript_id AS transcriptId, accepted_at AS acceptedAt FROM session_input_receipts
    WHERE conversation_id=? AND client_message_id=?`).get(conversationId, clientMessageId) as SessionInputReceipt | undefined;
  if (row && row.principalId !== principalId) throw new SessionCommandError('FORBIDDEN', 'Input belongs to another principal');
  return row;
}

export function matchSessionInputReceipt(conversationId: string, clientMessageId: string, principalId: string, hash: string): SessionInputReceipt | undefined {
  const receipt = getSessionInputReceipt(conversationId, clientMessageId, principalId);
  if (receipt && receipt.requestHash !== hash) throw new SessionCommandError('IDEMPOTENCY_CONFLICT', 'Input identity was reused with different content');
  if (isConversationDeleted(conversationId)) throw new SessionCommandError('SESSION_DELETED', 'Conversation was deleted');
  return receipt;
}

export function getSessionPreparation(conversationId: string): SessionPreparation | undefined {
  const row = getSqliteDatabase().prepare(`SELECT conversation_id AS conversationId, operation_id AS operationId,
    creation_json AS creationJson, state, environment_id AS environmentId, base_commit AS baseCommit,
    revision, lease_until AS leaseUntil, last_error AS lastError FROM session_preparations WHERE conversation_id=?`)
    .get(conversationId) as (Omit<SessionPreparation, 'creation'> & { creationJson: string }) | undefined;
  if (!row) return undefined;
  const { creationJson, ...rest } = row;
  return { ...rest, creation: JSON.parse(creationJson) as SessionCreation };
}

/** Commit the identity, configuration, input and replay receipt together. All preparation happens before entry. */
export function acceptSessionCommand(input: {
  conversationId: string; principalId: string; command: SessionInputCommand | SessionMaterializeCommand;
  preparedInput?: Omit<Parameters<typeof insertSessionInput>[0], 'conversationId' | 'id' | 'clientMessageId' | 'expectedTranscriptId'>;
  config?: SessionAgentConfig;
  sourceChannel?: 'webchat' | 'tui';
  attachProject?: (conversationId: string, projectId: string) => void;
}): SessionInputReceipt {
  return runSqliteWriteTransaction(db => {
    const { conversationId, command, principalId } = input;
    const clientMessageId = 'commandId' in command ? command.commandId : command.clientMessageId;
    const requestHash = sessionCommandHash(command);
    const existing = matchSessionInputReceipt(conversationId, clientMessageId, principalId, requestHash);
    if (existing) return existing;
    if (('input' in command) !== Boolean(input.preparedInput)) throw new SessionCommandError('BAD_REQUEST', 'Prepared input is required for input commands only');
    const pending = db.prepare(`SELECT count(*) AS count FROM session_inputs WHERE conversation_id=?
      AND status IN ('queued','running','injecting','interrupted')`).get(conversationId) as { count: number };
    if (input.preparedInput && pending.count >= 10) throw new SessionCommandError('QUEUE_FULL', 'Input queue is full');
    const creation = 'creation' in command ? command.creation : undefined;
    let session = getSessionMetadata(conversationId);
    if (creation) {
      if (session) throw new SessionCommandError('CONVERSATION_EXISTS', 'Conversation already exists');
      session = createConversation({
        agentId: creation.agentId, sourceChannel: input.sourceChannel ?? 'webchat', sourceChatId: conversationId,
        sessionType: 'chat', hiddenFromSessionList: !input.preparedInput,
        routing: { agentId: creation.agentId, source: input.sourceChannel ?? 'webchat', accountId: 'default', peerKind: 'direct', peerId: conversationId },
      }, '', conversationId);
      setSessionConfig(conversationId, input.config ?? {
        modelOverride: creation.model, fixedModel: true,
        thinkingLevel: creation.thinkingLevel as SessionAgentConfig['thinkingLevel'],
        userContextMode: creation.temporary ? 'temporary' : 'enabled',
      }, '');
      if (creation.projectId) {
        if (!input.attachProject) throw new Error('Project attachment is required');
        input.attachProject(conversationId, creation.projectId);
      }
      if (creation.execution) db.prepare(`INSERT INTO session_preparations
        (conversation_id,operation_id,creation_json,state,environment_id,created_at,updated_at)
        VALUES (?,?,?,'preparing',?,?,?)`).run(conversationId, randomUUID(), JSON.stringify(creation), randomUUID(), Date.now(), Date.now());
    } else {
      if (!session) throw new SessionCommandError('NOT_FOUND', 'Conversation not found');
      if (!('kind' in command) || command.kind !== 'append' || command.expectedTranscriptId !== session.transcriptId) throw new SessionCommandError('SESSION_CHANGED', 'Conversation transcript changed');
      const config = db.prepare('SELECT updated_at FROM session_config WHERE conversation_id=?').get(conversationId) as { updated_at: number } | undefined;
      if ((config?.updated_at ?? 0) !== command.configVersion) throw new SessionCommandError('CONFIG_CHANGED', 'Model configuration changed');
    }
    const transcriptId = session.transcriptId!;
    const inputId = input.preparedInput ? randomUUID() : null;
    if (input.preparedInput && inputId) insertSessionInput({ ...input.preparedInput, conversationId, id: inputId, clientMessageId, expectedTranscriptId: transcriptId });
    if (inputId) {
      invalidateConnectionResumeIntent(conversationId);
      supersedeActiveClarification(conversationId);
    }
    const receipt = { conversationId, clientMessageId, principalId, requestHash, inputId, transcriptId, acceptedAt: Date.now() };
    db.prepare(`INSERT INTO session_input_receipts
      (conversation_id,client_message_id,principal_id,request_hash,input_id,transcript_id,accepted_at)
      VALUES (?,?,?,?,?,?,?)`).run(conversationId, clientMessageId, principalId, requestHash, inputId, transcriptId, receipt.acceptedAt);
    return receipt;
  });
}

export function claimSessionPreparation(conversationId: string, now = Date.now()): SessionPreparation | undefined {
  return runSqliteWriteTransaction(db => {
    const changed = db.prepare(`UPDATE session_preparations SET lease_until=?,revision=revision+1,updated_at=?
      WHERE conversation_id=? AND state='preparing' AND lease_until<=?`)
      .run(now + 60_000, now, conversationId, now).changes;
    return changed ? getSessionPreparation(conversationId) : undefined;
  });
}

export function finishSessionPreparation(operation: SessionPreparation, error?: string): boolean {
  return runSqliteWriteTransaction(db => Boolean(db.prepare(`UPDATE session_preparations
    SET state=?,last_error=?,lease_until=0,revision=revision+1,updated_at=?
    WHERE conversation_id=? AND operation_id=? AND revision=? AND state='preparing'`)
    .run(error ? 'preparation_failed' : 'ready', error ?? null, Date.now(), operation.conversationId, operation.operationId, operation.revision).changes));
}

export function pendingSessionPreparations(): string[] {
  return (getSqliteDatabase().prepare("SELECT conversation_id FROM session_preparations WHERE state='preparing' AND lease_until<=?")
    .all(Date.now()) as { conversation_id: string }[]).map(row => row.conversation_id);
}

export function retrySessionPreparation(conversationId: string, principalId: string,
  input: { operationId: string; expectedRevision: number; idempotencyKey: string }): SessionPreparation {
  return runSqliteWriteTransaction(db => {
    if (isConversationDeleted(conversationId)) throw new SessionCommandError('SESSION_DELETED', 'Conversation was deleted');
    const operation = getSessionPreparation(conversationId);
    if (!operation) throw new SessionCommandError('NOT_FOUND', 'Preparation not found');
    const owner = db.prepare('SELECT principal_id FROM session_input_receipts WHERE conversation_id=? ORDER BY accepted_at LIMIT 1')
      .get(conversationId) as { principal_id: string } | undefined;
    if (owner?.principal_id !== principalId) throw new SessionCommandError('FORBIDDEN', 'Preparation belongs to another principal');
    const previous = db.prepare('SELECT * FROM session_preparation_retries WHERE conversation_id=? AND idempotency_key=?')
      .get(conversationId, input.idempotencyKey) as { operation_id: string; expected_revision: number; principal_id: string } | undefined;
    if (previous) {
      if (previous.operation_id !== input.operationId || previous.expected_revision !== input.expectedRevision
        || previous.principal_id !== principalId) throw new SessionCommandError('IDEMPOTENCY_CONFLICT', 'Retry identity was reused');
      return operation;
    }
    const changed = db.prepare(`UPDATE session_preparations SET state='preparing', revision=revision+1,
      lease_until=0,last_error=NULL,updated_at=? WHERE conversation_id=? AND operation_id=? AND revision=? AND state='preparation_failed'`)
      .run(Date.now(), conversationId, input.operationId, input.expectedRevision).changes;
    if (!changed) throw new SessionCommandError('SESSION_CHANGED', 'Preparation state changed');
    db.prepare('INSERT INTO session_preparation_retries VALUES (?,?,?,?,?)')
      .run(conversationId, input.idempotencyKey, input.operationId, input.expectedRevision, principalId);
    return getSessionPreparation(conversationId)!;
  });
}
