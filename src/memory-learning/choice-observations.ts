import { createHash } from 'node:crypto';

import type { Config } from '../config/schema.js';
import { inferMemorySensitivity } from '../agent/memory/sensitivity.js';
import { canonicalWorkspacePath } from '../projects/workspace-project.js';
import { retrievalLexicalSimilarity } from '../retrieval/textFeatures.js';
import { canRecallConversation, canRecallHistoryEntry } from '../session/history-recall-policy.js';
import { stripRuntimeContextFromUserMessage } from '../session/user-message-display.js';
import { createContextEvidence } from '../storage/sqlite/context-evidence-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { isMemorySuppressed, memoryFingerprint, suppressMemory } from '../user-context/memory-suppression.js';
import { resolveUserContextSessionAccess } from '../user-context/access-policy.js';
import { observedChoiceClauses, hasOwnerMemoryDirective } from '../user-model/capture/evidence-policy.js';
import type { CaptureEvidence } from '../user-model/capture/semantic.js';
import type { CaptureScopeContext } from '../user-model/capture/executor.js';
import { recordUserModelObservation, listUserModelObservations } from '../user-model/observation-repository.js';
import { forgottenHistoryEntries, projectUnadmittedForgottenFields } from './forgotten-history.js';
import { learningTranscriptMessage } from './transcript-source.js';

const TYPE = 'conversation_choice';
const MEMORY_DENIAL = /(?:不要|别|不必|无需).{0,8}(?:记住|记录|保存)|\b(?:do not|don't|never)\s+(?:remember|record|save)\b/iu;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const normalized = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const sourceKey = (conversation: string, ref: string) => memoryFingerprint(['conversation-choice-source', conversation, ref]);

function enabled(config: Config, context: CaptureScopeContext): boolean {
  return config.userContext.userModel.writePolicy === 'allow'
    && config.userContext.userModel.extraction.crossSessionObservations
    && resolveUserContextSessionAccess(config, context.conversationId).userModel;
}

/** Hints are bounded raw choices, not assertions or model-generated predictions about the user. */
export function recordChoiceObservations(config: Config, context: CaptureScopeContext, evidence: CaptureEvidence[]): number {
  if (!enabled(config, context)) return 0;
  const db = getSqliteDatabase();
  const blocked = forgottenHistoryEntries(context);
  let count = 0;
  for (const source of evidence) {
    if (source.role !== 'user' || source.observationScope || source.text.length > 3000
      || source.createdAt < Date.now() - config.userContext.userModel.extraction.observationWindowDays * 86400000
      || inferMemorySensitivity(source.text) !== 'normal'
      || blocked.has(`${context.conversationId}:*`) || blocked.has(`${context.conversationId}:${source.ref}`)
      || isMemorySuppressed(db, [sourceKey(context.conversationId, source.ref)])
      || projectUnadmittedForgottenFields(source.text, context) !== source.text
      || MEMORY_DENIAL.test(source.text)
      || (['remember', 'correct', 'forget', 'confirm'] as const).some(command => hasOwnerMemoryDirective(source.text, command))
      || !canRecallHistoryEntry(context, context.conversationId, source.ref, source.text)) continue;
    const choices = observedChoiceClauses(source.text).filter(quote => quote.length <= 500);
    if (!choices.length) continue;
    const existing = db.prepare(`SELECT evidence_id, content_hash FROM context_evidence
      WHERE principal_id='local-owner' AND source_type='conversation' AND source_ref=?`).get(`session:${context.conversationId}:entry:${source.ref}`) as
      { evidence_id: string; content_hash: string } | undefined;
    if (existing && existing.content_hash !== hash(source.text)) continue;
    const evidenceRow = existing ? { id: existing.evidence_id } : createContextEvidence({ sourceType: 'conversation',
      sourceRef: `session:${context.conversationId}:entry:${source.ref}`, conversationId: context.conversationId,
      messageId: source.ref, contentHash: hash(source.text), trustLevel: 'owner', observedAt: source.createdAt,
      processingPolicy: config.userContext.userModel.processingPolicy });
    recordUserModelObservation({ domain: 'behavior', type: TYPE, subject: { type: 'user', id: 'self' },
      value: { ref: source.ref, quote: choices.join('\n') },
      context: { conversationId: context.conversationId, agentId: context.agentId,
        workspaceId: canonicalWorkspacePath(context.workspaceId), projectId: context.projectId ?? '', sourceHash: hash(source.text) },
      ownerAttribution: 'user', observedAt: source.createdAt, sensitivityCategories: [], evidenceId: evidenceRow.id,
      sourceItemId: source.ref, deleteAfter: source.createdAt + config.userContext.userModel.extraction.observationWindowDays * 86400000,
      contentHash: sourceKey(context.conversationId, source.ref) });
    count++;
  }
  return count;
}

/** Reload authorized original rows so cached observations cannot bypass revocation or deletion. */
export function recallChoiceEvidence(config: Config, context: CaptureScopeContext, fresh: CaptureEvidence[]): CaptureEvidence[] {
  if (!enabled(config, context)) return [];
  const queries = fresh.filter(e => e.role === 'user' && !MEMORY_DENIAL.test(e.text)
    && !( ['remember', 'correct', 'forget', 'confirm'] as const).some(command => hasOwnerMemoryDirective(e.text, command))
    && inferMemorySensitivity(e.text) === 'normal').flatMap(e => observedChoiceClauses(e.text));
  if (!queries.length) return [];
  const db = getSqliteDatabase();
  const blocked = forgottenHistoryEntries(context);
  const result: CaptureEvidence[] = [];
  const seen = new Set(fresh.map(e => e.ref));
  const quotes = new Set(queries.map(normalized));
  for (const observation of listUserModelObservations({ domain: 'behavior', type: TYPE, context: { agentId: context.agentId, workspaceId: canonicalWorkspacePath(context.workspaceId), projectId: context.projectId ?? '' }, limit: 200 })) {
    const origin = observation.context;
    const value = observation.value as { ref?: string; quote?: string };
    if (observation.type !== TYPE || !value.ref || !value.quote || typeof origin.conversationId !== 'string'
      || seen.has(value.ref) || observation.ownerAttribution !== 'user'
      || observation.deleteAfter <= Date.now() || observation.observedAt < Date.now() - config.userContext.userModel.extraction.observationWindowDays * 86400000
      || origin.agentId !== context.agentId || origin.workspaceId !== canonicalWorkspacePath(context.workspaceId)
      || origin.projectId !== (context.projectId ?? '') || quotes.has(normalized(value.quote))
      || !queries.some(query => retrievalLexicalSimilarity(query, value.quote!) >= 0.3)
      || isMemorySuppressed(db, [sourceKey(origin.conversationId, value.ref)])
      || blocked.has(`${origin.conversationId}:*`) || blocked.has(`${origin.conversationId}:${value.ref}`)
      || !canRecallConversation(config, context, origin.conversationId)) continue;
    const policy = observation.evidenceId ? db.prepare('SELECT processing_policy FROM context_evidence WHERE evidence_id=?').get(observation.evidenceId) as { processing_policy: string } | undefined : undefined;
    if (policy?.processing_policy === 'local_only' && config.userContext.userModel.processingPolicy !== 'local_only') continue;
    const row = db.prepare(`SELECT e.role, e.payload_json, e.created_at FROM transcript_entries e
      JOIN transcripts t ON t.transcript_id=e.transcript_id WHERE e.entry_id=? AND t.conversation_id=?`)
      .get(value.ref, origin.conversationId) as { role: string; payload_json: string; created_at: number } | undefined;
    if (!row) continue;
    const message = learningTranscriptMessage(row);
    if (!message || message.role !== 'user') continue;
    const raw = typeof message.content === 'string' ? message.content : message.content.filter(p => p.type === 'text').map(p => p.text).join('');
    const text = stripRuntimeContextFromUserMessage(raw);
    if (hash(text) !== origin.sourceHash || !text.includes(value.quote.split('\n')[0])
      || !canRecallHistoryEntry(context, origin.conversationId, value.ref, text)
      || projectUnadmittedForgottenFields(text, context) !== text || inferMemorySensitivity(text) !== 'normal') continue;
    result.push({ ref: value.ref, role: 'user', text, createdAt: row.created_at, conversationId: origin.conversationId,
      observationScope: context.projectId ? { type: 'project', id: context.projectId } : { type: 'workspace', id: context.workspaceId } });
    seen.add(value.ref); quotes.add(normalized(value.quote));
    if (result.length >= config.userContext.userModel.extraction.maxObservationEvidence) break;
  }
  return result;
}

/** Forget pending hints as well as derived assertions; replaying old rows must not recreate them. */
export function forgetChoiceObservations(context: CaptureScopeContext): void {
  const db = getSqliteDatabase();
  const rows = db.prepare(`SELECT observation_id, content_hash FROM user_model_observations WHERE observation_type=?
    AND json_extract(context_json,'$.agentId')=? AND json_extract(context_json,'$.workspaceId')=?
    AND json_extract(context_json,'$.projectId')=?`).all(TYPE, context.agentId, canonicalWorkspacePath(context.workspaceId), context.projectId ?? '') as
    Array<{ observation_id: string; content_hash: string }>;
  for (const row of rows) {
    suppressMemory(db, [row.content_hash], Date.now());
    db.prepare('DELETE FROM user_model_observations WHERE observation_id=?').run(row.observation_id);
  }
}
