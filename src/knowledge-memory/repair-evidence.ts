import { createContextEvidence } from '../storage/sqlite/context-evidence-repository.js';
import { getKnowledgeSourceItem } from '../storage/sqlite/knowledge-repository.js';
import { getUnderstandingSourceRun } from '../user-context/sources/repository.js';
import { getActiveUnderstandingConsent } from '../user-context/sources/consent-repository.js';
import { listKnowledgeItems, writeKnowledgeItem } from './repository.js';

/** Legacy summaries are usable only when their original retained source can still be verified. */
export function repairLegacyKnowledgeEvidence(): number {
  let repaired = 0;
  for (const item of listKnowledgeItems({ recordClass: 'memory', statuses: ['candidate'], limit: 1000 })) {
    if (item.originClass !== 'untrusted' || item.verification !== 'tentative'
      || typeof item.source.sourceRunId !== 'string' || !Array.isArray(item.source.evidenceRefs)) continue;
    const run = getUnderstandingSourceRun(item.source.sourceRunId);
    const consent = run ? getActiveUnderstandingConsent(run.grantId) : undefined;
    if (!consent || !consent.purposes.includes('work_assistance')) continue;
    const refs = item.source.evidenceRefs.filter((ref): ref is string => typeof ref === 'string');
    const sources = refs.map(ref => ref.startsWith('knowledge-source://') ? getKnowledgeSourceItem(ref.slice(19)) : undefined);
    if (!sources.length || sources.some(source => !source || source.deletedAt || Date.parse(source.updatedAt) > item.updatedAt)) continue;
    const evidence = sources.map(source => {
      const record = createContextEvidence({ sourceType: 'connector', sourceInstanceId: source!.sourceInstanceId,
        sourceRef: `knowledge-source://${source!.id}`, sourceItemId: source!.id, contentHash: source!.contentHash,
        trustLevel: 'untrusted', observedAt: Date.parse(source!.updatedAt), processingPolicy: consent.processingPolicy });
      return { id: record.id, contentHash: source!.contentHash, consentReceiptId: consent.id };
    });
    writeKnowledgeItem({ ...item, claimMode: 'reported', verification: 'supported', status: item.confidence >= 0.7 ? 'active' : 'candidate',
      evidence, replaceExisting: true, source: { ...item.source, consentReceiptId: consent.id,
        sourceInstanceId: sources[0]!.sourceInstanceId } });
    repaired += 1;
  }
  return repaired;
}
