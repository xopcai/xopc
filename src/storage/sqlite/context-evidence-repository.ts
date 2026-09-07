import { createHash, randomUUID } from 'node:crypto';

import { USER_MODEL_PRINCIPAL_ID } from '../../user-model/domain.js';
import { getSqliteDatabase } from './transaction.js';

export interface ContextEvidence {
  id: string;
  sourceType: 'conversation' | 'connector' | 'user' | 'runtime';
  sourceInstanceId?: string;
  sourceRef: string;
  sourceRunId?: string;
  sourceItemId?: string;
  sessionId?: string;
  turnId?: string;
  messageId?: string;
  contentHash?: string;
  retentionPolicy?: string;
  processingPolicy?: 'local_only' | 'remote_allowed';
  extractorId?: string;
  extractorVersion?: string;
  redactedExcerpt?: string;
  trustLevel: 'owner' | 'trusted' | 'untrusted';
  observedAt: number;
  ingestedAt: number;
  createdAt: number;
}

type EvidenceRow = {
  evidence_id: string; source_type: ContextEvidence['sourceType']; source_instance_id: string | null;
  source_ref: string; source_run_id: string | null; source_item_id: string | null;
  session_id: string | null; turn_id: string | null; message_id: string | null;
  content_hash: string | null; retention_policy: string | null;
  processing_policy: ContextEvidence['processingPolicy'] | null; extractor_id: string | null;
  extractor_version: string | null; redacted_excerpt: string | null;
  trust_level: ContextEvidence['trustLevel']; observed_at: number; ingested_at: number | null; created_at: number;
};

function fromRow(row: EvidenceRow): ContextEvidence {
  return {
    id: row.evidence_id,
    sourceType: row.source_type,
    ...(row.source_instance_id ? { sourceInstanceId: row.source_instance_id } : {}),
    sourceRef: row.source_ref,
    ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
    ...(row.source_item_id ? { sourceItemId: row.source_item_id } : {}),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.turn_id ? { turnId: row.turn_id } : {}),
    ...(row.message_id ? { messageId: row.message_id } : {}),
    ...(row.content_hash ? { contentHash: row.content_hash } : {}),
    ...(row.retention_policy ? { retentionPolicy: row.retention_policy } : {}),
    ...(row.processing_policy ? { processingPolicy: row.processing_policy } : {}),
    ...(row.extractor_id ? { extractorId: row.extractor_id } : {}),
    ...(row.extractor_version ? { extractorVersion: row.extractor_version } : {}),
    ...(row.redacted_excerpt ? { redactedExcerpt: row.redacted_excerpt } : {}),
    trustLevel: row.trust_level,
    observedAt: row.observed_at,
    ingestedAt: row.ingested_at ?? row.created_at,
    createdAt: row.created_at,
  };
}

export function createContextEvidence(
  input: Omit<ContextEvidence, 'id' | 'ingestedAt' | 'createdAt'> & { ingestedAt?: number },
  principalId = USER_MODEL_PRINCIPAL_ID,
): ContextEvidence {
  const db = getSqliteDatabase();
  const existing = db.prepare(`SELECT * FROM context_evidence WHERE principal_id = ?
    AND source_type = ? AND COALESCE(source_instance_id, '') = COALESCE(?, '') AND source_ref = ?`)
    .get(principalId, input.sourceType, input.sourceInstanceId ?? null, input.sourceRef) as EvidenceRow | undefined;
  const contentHash = input.contentHash ?? (input.redactedExcerpt
    ? createHash('sha256').update(input.redactedExcerpt).digest('hex') : undefined);
  if (existing) {
    db.prepare(`UPDATE context_evidence SET
      source_run_id = ?, source_item_id = ?, session_id = ?, turn_id = ?, message_id = ?,
      content_hash = ?, retention_policy = ?, processing_policy = ?, extractor_id = ?,
      extractor_version = ?, redacted_excerpt = ?, trust_level = ?, observed_at = ?, ingested_at = ?
      WHERE evidence_id = ?`).run(
      input.sourceRunId ?? null,
      input.sourceItemId ?? null,
      input.sessionId ?? null,
      input.turnId ?? null,
      input.messageId ?? null,
      contentHash ?? null,
      input.retentionPolicy ?? null,
      input.processingPolicy ?? null,
      input.extractorId ?? null,
      input.extractorVersion ?? null,
      input.redactedExcerpt ?? null,
      input.trustLevel,
      input.observedAt,
      input.ingestedAt ?? Date.now(),
      existing.evidence_id,
    );
    return fromRow(db.prepare('SELECT * FROM context_evidence WHERE evidence_id = ?')
      .get(existing.evidence_id) as EvidenceRow);
  }
  const createdAt = Date.now();
  const id = randomUUID();
  db.prepare(`INSERT INTO context_evidence (
    evidence_id, principal_id, source_type, source_instance_id, source_ref, source_run_id,
    source_item_id, session_id, turn_id, message_id, content_hash, retention_policy,
    processing_policy, extractor_id, extractor_version, redacted_excerpt, trust_level,
    observed_at, ingested_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, principalId, input.sourceType, input.sourceInstanceId ?? null, input.sourceRef,
    input.sourceRunId ?? null, input.sourceItemId ?? null, input.sessionId ?? null,
    input.turnId ?? null, input.messageId ?? null, contentHash ?? null,
    input.retentionPolicy ?? null, input.processingPolicy ?? null, input.extractorId ?? null,
    input.extractorVersion ?? null, input.redactedExcerpt ?? null, input.trustLevel,
    input.observedAt, input.ingestedAt ?? createdAt, createdAt,
  );
  return fromRow(db.prepare('SELECT * FROM context_evidence WHERE evidence_id = ?').get(id) as EvidenceRow);
}
