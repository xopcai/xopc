import { createHash } from 'node:crypto';

import { createLogger } from '../utils/logger.js';

import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { deleteKnowledgeItem, getKnowledgeItem, canUseKnowledge, writeKnowledgeItem } from '../knowledge-memory/index.js';
import { createCollaborationRule, listCollaborationRules } from '../storage/sqlite/collaboration-rule-repository.js';
import type { CaptureScopeContext } from '../user-model/capture/executor.js';
import type { CaptureEvidence, UserModelInterpretation } from '../user-model/capture/semantic.js';

import { isUnquotedOwnerEvidence } from './owner-directive.js';

const log = createLogger('MemoryLearning:Forget');

/** Only grounded owner requests can forget derived knowledge visible in this scope. */
export function applyKnowledgeDeletions(input: {
  interpretation: UserModelInterpretation; evidence: CaptureEvidence[];
  context: CaptureScopeContext; allowedTargetIds: string[];
}): Array<{ candidateKey: string; objectType: 'knowledge'; objectId: string; outcome: 'created' | 'rejected' }> {
  return runSqliteWriteTransaction((db) => {
    const outputs: Array<{ candidateKey: string; objectType: 'knowledge'; objectId: string; outcome: 'created' | 'rejected' }> = [];
    for (const operation of input.interpretation.knowledgeDeletions ?? []) {
      if (!operation.evidenceRefs.length || operation.evidenceRefs.some(ref =>
        !input.evidence.some(entry => entry.ref === ref && entry.role === 'user'))) continue;
      if (!operation.evidence?.length || operation.evidence.some(claim => !input.evidence.some(entry =>
        entry.ref === claim.ref && entry.role === 'user' && isUnquotedOwnerEvidence(entry.text, claim.quote)))) continue;
      let targets = operation.targetKnowledgeIds.flatMap(id => {
        const item = input.allowedTargetIds.includes(id) ? getKnowledgeItem(id) : undefined;
        return item && item.recordClass === 'memory' && canUseKnowledge(item, input.context) ? [item] : [];
      });
      const requestedRetention = operation.retained ?? [];
      const invalidTargets = new Set(requestedRetention.filter(part => {
        const item = targets.find(target => target.id === part.targetKnowledgeId);
        return !item || !part.spans.length || part.spans.some(span => !span.trim() || !item.content.includes(span));
      }).map(part => part.targetKnowledgeId));
      if (invalidTargets.size) log.warn({ phase: 'forget_retention', count: invalidTargets.size,
        conversationId: input.context.conversationId }, 'Ungrounded retained spans rejected; affected knowledge was preserved');
      targets = targets.filter(item => !invalidTargets.has(item.id));
      const retained = requestedRetention.filter(part => targets.some(item => item.id === part.targetKnowledgeId));
      for (const part of retained) {
        const item = targets.find(target => target.id === part.targetKnowledgeId)!;
        const content = [...new Set(part.spans)].join('；');
        const links = db.prepare(`SELECT evidence_id, content_hash, consent_receipt_id FROM knowledge_evidence_links
          WHERE knowledge_id = ?`).all(item.id) as Array<{ evidence_id: string; content_hash: string | null; consent_receipt_id: string | null }>;
        const saved = writeKnowledgeItem({ ...item, content,
          canonicalKey: `${item.canonicalKey}:retained:${createHash('sha256').update(content).digest('hex').slice(0, 16)}`,
          evidence: links.map(link => ({ id: link.evidence_id, contentHash: link.content_hash ?? undefined,
            consentReceiptId: link.consent_receipt_id ?? undefined })),
          source: { ...item.source, evidenceQuotes: undefined, retainedFromKnowledgeId: item.id }, replaceExisting: false });
        if (!saved.item) throw new Error('Unable to retain unforgotten knowledge; deletion was rolled back.');
        outputs.push({ candidateKey: saved.item.canonicalKey, objectType: 'knowledge', objectId: saved.item.id, outcome: 'created' });
      }
      const forgottenEntries = targets.flatMap(item => (db.prepare(`SELECT DISTINCT e.conversation_id, e.message_id
        FROM context_evidence e WHERE e.conversation_id IS NOT NULL AND e.message_id IS NOT NULL
          AND (e.evidence_id IN (SELECT evidence_id FROM knowledge_evidence_links WHERE knowledge_id=?)
            OR e.message_id IN (SELECT value FROM knowledge_revisions r, json_each(r.source_json, '$.evidenceRefs')
              WHERE r.knowledge_id=?))`)
        .all(item.id, item.id) as Array<{ conversation_id: string; message_id: string }>).flatMap(entry =>
          [`${entry.conversation_id}:${entry.message_id}`, `${entry.conversation_id}:*`]))
        .concat((targets.length || (!operation.targetKnowledgeIds.length && operation.reread)) && input.context.conversationId ? [`${input.context.conversationId}:*`] : []);
      for (const item of targets) {
        deleteKnowledgeItem(item.id, Date.now(), { includeRelated: false });
        outputs.push({ candidateKey: item.id, objectType: 'knowledge', objectId: item.id, outcome: 'rejected' });
      }
      // Retain the disclosure boundary, never the deleted values. Original transcripts stay intact.
      const scopes = targets.map(item => item.scope);
      if (!operation.targetKnowledgeIds.length && operation.reread && input.context.workspaceId) scopes.push(input.context.projectId ? { type: 'project', id: input.context.projectId } : { type: 'workspace', id: input.context.workspaceId });
      for (const scope of new Map(scopes.map(scope => [JSON.stringify(scope), scope])).values()) {
        if (scope.type === 'agent') continue;
        const exists = listCollaborationRules().some(rule => rule.category === 'boundary' && rule.status === 'active'
          && JSON.stringify(rule.scope) === JSON.stringify(scope) && rule.statement === operation.boundary
          && forgottenEntries.every(entry => Array.isArray(rule.conditions.forgottenHistoryEntries)
            && rule.conditions.forgottenHistoryEntries.includes(entry)));
        if (!exists) createCollaborationRule({ category: 'boundary', priority: 0, scope,
          conditions: { enforcementLevel: 'prompt', forgottenHistoryEntries: [...new Set(forgottenEntries)], reread: operation.reread, ...(operation.reread ? { unadmittedFieldCoverage: true } : {}) }, statement: operation.boundary, status: 'active' });
      }
    }
    return outputs;
  });
}
