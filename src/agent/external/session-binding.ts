import type { ExternalAgentExecution } from '../../agent-config/schema.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import type { StoredAgent } from '../../agent-catalog/types.js';
import type { TranscriptStoredRow } from '../../session/session-context-for-llm.js';
import { isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import type { ExternalSessionBinding, ExternalSessionIdentity } from './types.js';

export type ExternalStoredAgent = StoredAgent & {
  execution: ExternalAgentExecution;
};

export function getExternalAgent(agentId: string): ExternalStoredAgent | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const agent = new AgentCatalogRepository().get(agentId, { includeDeleted: true });
  return agent?.execution ? (agent as ExternalStoredAgent) : undefined;
}

export function getExternalConversationAgent(conversationId: string): ExternalStoredAgent | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const metadata = getSessionMetadata(conversationId);
  return metadata ? getExternalAgent(metadata.agentId) : undefined;
}

export function isExternalConversation(conversationId: string): boolean {
  return Boolean(getExternalConversationAgent(conversationId));
}

export function hasExternalSessionBinding(conversationId: string): boolean {
  if (!isXopcDatabaseOpen()) return false;
  const transcriptId = readCurrentTranscriptId(getSqliteDatabase(), conversationId);
  if (!transcriptId) return false;
  return Boolean(
    getSqliteDatabase()
      .prepare('SELECT 1 FROM external_agent_session_bindings WHERE transcript_id = ?')
      .get(transcriptId),
  );
}

type BindingRow = {
  transcriptId: string;
  runtimeKind: string;
  agentId: string;
  cwd: string;
  nativeSessionId: string;
  resumeCursor: string | null;
  metadataJson: string | null;
  inputUnchanged: number;
};

function parseMetadata(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function readExternalSessionBinding(identity: ExternalSessionIdentity): ExternalSessionBinding | undefined {
  const binding = getSqliteDatabase().prepare(`
    SELECT transcript_id AS transcriptId,
      runtime_kind AS runtimeKind,
      agent_id AS agentId,
      cwd,
      native_session_id AS nativeSessionId,
      resume_cursor AS resumeCursor,
      metadata_json AS metadataJson,
      last_input_entry_id IS NULL OR EXISTS (
        SELECT 1 FROM transcript_entries e WHERE e.entry_id = last_input_entry_id AND e.transcript_id = b.transcript_id
      ) AS inputUnchanged
    FROM external_agent_session_bindings b WHERE transcript_id = ?
  `).get(identity.transcriptId) as BindingRow | undefined;
  if (!binding) return undefined;
  if (
    binding.runtimeKind !== identity.runtimeKind
    || binding.agentId !== identity.agentId
    || binding.cwd !== identity.cwd
    || !binding.inputUnchanged
  ) {
    throw new Error('This external runtime conversation no longer matches this session or workspace. Start a new session or reset this one.');
  }
  return {
    transcriptId: binding.transcriptId,
    runtimeKind: identity.runtimeKind,
    agentId: binding.agentId,
    cwd: binding.cwd,
    nativeSessionId: binding.nativeSessionId,
    ...(binding.resumeCursor ? { resumeCursor: binding.resumeCursor } : {}),
    ...(binding.metadataJson ? { metadata: parseMetadata(binding.metadataJson) } : {}),
  };
}

export function readExternalSessionLastInputEntryId(transcriptId: string): string | null {
  const row = getSqliteDatabase()
    .prepare('SELECT last_input_entry_id AS lastInputEntryId FROM external_agent_session_bindings WHERE transcript_id = ?')
    .get(transcriptId) as { lastInputEntryId: string | null } | undefined;
  return row?.lastInputEntryId ?? null;
}

export function bindExternalSession(
  identity: ExternalSessionIdentity,
  binding: {
    nativeSessionId: string;
    inputEntryId?: string | null;
    resumeCursor?: string;
    metadata?: Record<string, unknown>;
    allowSessionRotation?: boolean;
  },
): void {
  runSqliteWriteTransaction(db => {
    if (readCurrentTranscriptId(db, identity.conversationId) !== identity.transcriptId) {
      throw new Error('The session changed while the external runtime was starting.');
    }
    const previous = readExternalSessionBinding(identity);
    if (previous && previous.nativeSessionId !== binding.nativeSessionId && !binding.allowSessionRotation) {
      throw new Error('The external runtime session changed unexpectedly while starting this run.');
    }
    const metadataJson = binding.metadata ? JSON.stringify(binding.metadata) : null;
    db.prepare(`
      INSERT INTO external_agent_session_bindings (
        transcript_id, runtime_kind, agent_id, cwd, native_session_id,
        resume_cursor, last_input_entry_id, metadata_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (transcript_id) DO UPDATE SET
        native_session_id = excluded.native_session_id,
        resume_cursor = COALESCE(excluded.resume_cursor, external_agent_session_bindings.resume_cursor),
        last_input_entry_id = excluded.last_input_entry_id,
        metadata_json = COALESCE(excluded.metadata_json, external_agent_session_bindings.metadata_json),
        updated_at = excluded.updated_at
    `).run(
      identity.transcriptId,
      identity.runtimeKind,
      identity.agentId,
      identity.cwd,
      binding.nativeSessionId,
      binding.resumeCursor ?? null,
      binding.inputEntryId ?? null,
      metadataJson,
      Date.now(),
    );
  });
}

/** Clear last_input_entry_id after an intentional external rollback so the next turn can resume cleanly. */
export function clearExternalSessionLastInputEntry(transcriptId: string): void {
  runSqliteWriteTransaction(db => {
    db.prepare(`
      UPDATE external_agent_session_bindings
      SET last_input_entry_id = NULL, updated_at = ?
      WHERE transcript_id = ?
    `).run(Date.now(), transcriptId);
  });
}

export function appendExternalTranscriptEntry(
  identity: ExternalSessionIdentity,
  entryId: string,
  row: TranscriptStoredRow,
): boolean {
  return runSqliteWriteTransaction(db => {
    if (readCurrentTranscriptId(db, identity.conversationId) !== identity.transcriptId) return false;
    appendTranscriptEntry(identity.conversationId, row, { transcriptId: identity.transcriptId, entryId });
    return true;
  });
}

export function updateExternalTranscriptEntry(
  identity: ExternalSessionIdentity,
  entryId: string,
  row: TranscriptStoredRow,
): boolean {
  return runSqliteWriteTransaction(db => {
    if (readCurrentTranscriptId(db, identity.conversationId) !== identity.transcriptId) return false;
    const result = db.prepare(`
      UPDATE transcript_entries
      SET payload_json = ?
      WHERE transcript_id = ? AND entry_id = ?
    `).run(JSON.stringify(row), identity.transcriptId, entryId);
    return result.changes > 0;
  });
}
