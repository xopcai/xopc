import type { PersonalProvenanceDetail } from '@xopcai/gateway-contract';

import { getOneShotFollowUpDto } from './one-shot-follow-up.js';
import { getAttention, getAttentionSources, getOutreach, sourceFingerprint, strategyState } from './repository.js';

export function provenanceDetail(ownerId: string, id: string): PersonalProvenanceDetail | undefined {
  const outreach = getOutreach(id, ownerId);
  if (!outreach || outreach.state !== 'published') return undefined;
  const thread = getAttention(outreach.thread_id, ownerId)!;
  const snapshot = JSON.parse(outreach.provenance_json);
  const currentSources = getAttentionSources(thread.id, snapshot.sourceIds);
  const sources = sourceFingerprint(currentSources) === snapshot.fingerprint ? currentSources : [];
  const oneShot = thread.follow_up_mode === 'one_shot' ? getOneShotFollowUpDto(thread.id, ownerId) : undefined;
  return { provenance: snapshot.display,
    thread: { id: thread.id, subject: sources.length ? thread.subject : '', status: thread.status,
      revision: thread.revision, nextCheckAt: thread.next_check_at },
    whyNow: sources.length ? outreach.reason : '', sourcesAvailable: sources.length > 0,
    sources: sources.map(({ processingPolicy: _policy, version: _version, ...source }) => source),
    strategy: strategyState(thread.id),
    ...(oneShot ? { oneShotFollowUp: oneShot } : {}) };
}
