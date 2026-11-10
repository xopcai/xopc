import type { CaptureEvidence, UserModelInterpretation, ParsedAssertionOperation } from '../user-model/capture/semantic.js';
import type { WorkCandidate } from './work-candidate.js';

export function workCandidateKey(candidate: WorkCandidate): string {
  return `${candidate.topicKey.normalize('NFKC').toLowerCase()}:${candidate.predicate}`;
}

/** Preflight provenance without creating evidence, knowledge or suppression records. */
export function workEvidenceIssues(candidates: WorkCandidate[], evidence: CaptureEvidence[]) {
  return candidates.flatMap((candidate, index) => {
    const missing = candidate.evidence.some(claim => !evidence.some(source => source.ref === claim.ref));
    const mismatch = candidate.evidence.some(claim => !evidence.some(source => source.ref === claim.ref
      && source.text.normalize('NFKC').includes(claim.quote.normalize('NFKC'))));
    return missing || mismatch ? [{ index, key: workCandidateKey(candidate),
      reasonCode: missing ? 'evidence_ref_missing' : 'evidence_quote_mismatch' }] : [];
  });
}

export function observationCandidateIssue(candidate: ParsedAssertionOperation, evidence: CaptureEvidence[]): string | undefined {
  const observations = candidate.evidenceRefs.flatMap(ref => evidence.find(source => source.ref === ref)?.observationScope ?? []);
  return observations.length && (!['preference', 'routine'].includes(candidate.kind)
    || !['user_observed', 'system_inferred'].includes(candidate.authority) || candidate.sensitivity !== 'normal'
    || !['low', 'medium'].includes(candidate.consequence)
    || observations.some(scope => scope.type !== candidate.scope.type || scope.id !== candidate.scope.id))
    ? 'observation_scope_or_authority' : undefined;
}

/** Repair only the failed candidates; keep valid personal operations and work candidates unchanged. */
export function mergeEvidenceRepair(base: UserModelInterpretation, repaired: UserModelInterpretation, evidence: CaptureEvidence[]): UserModelInterpretation {
  const broken = new Set(workEvidenceIssues(base.knowledge ?? [], evidence).map(issue => issue.key));
  return { ...base,
    assertions: base.assertions.map(candidate => observationCandidateIssue(candidate, evidence)
      ? repaired.assertions.find(next => next.predicate === candidate.predicate && next.normalizedValue === candidate.normalizedValue) ?? candidate : candidate),
    knowledge: (base.knowledge ?? []).map(candidate => broken.has(workCandidateKey(candidate))
    ? repaired.knowledge?.find(next => workCandidateKey(next) === workCandidateKey(candidate)) ?? candidate : candidate) };
}
