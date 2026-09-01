import {
  closeTemporalAssertions,
  closeUnderstandingValidity,
  createTemporalAssertion,
  createContextEvidence,
  createUnderstanding,
  getUnderstanding,
  getContextExtractionRun,
  isUnderstandingSuppressed,
  linkUnderstandingEvidence,
  linkContextObjects,
  listUnderstandings,
  setUnderstandingStatus,
} from '../../../storage/sqlite/index.js';
import { getRegisteredExtractorDefinition } from '../../../user-context/extraction/registry.js';
import type { UserContextScope } from '../../../user-context/domain.js';
import {
  canonicalUnderstandingKey,
  findContradictoryUnderstanding,
  findDuplicateUnderstanding,
} from '../../../user-context/understanding.js';
import { inferMemorySensitivity, redactSensitiveMemoryText } from '../sensitivity.js';
import type { UnderstandingCandidate, UnderstandingReviewResult } from './types.js';

const MAX_CANDIDATE_CHARS = 600;
const SENSITIVITY_RANK = { normal: 0, personal: 1, secret: 2, regulated: 3 } as const;

function effectiveSensitivity(
  declared: UnderstandingCandidate['sensitivity'],
  content: string,
): UnderstandingCandidate['sensitivity'] {
  const inferred = inferMemorySensitivity(content);
  return SENSITIVITY_RANK[inferred] > SENSITIVITY_RANK[declared] ? inferred : declared;
}

function normalizeContent(raw: string): string {
  return raw.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CANDIDATE_CHARS);
}

function candidateTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function scopeForCandidate(candidate: UnderstandingCandidate, context: {
  sessionKey?: string;
  workspaceId?: string;
  projectId?: string;
}): UserContextScope {
  if (candidate.durability === 'ephemeral' && context.sessionKey) return { type: 'session', id: context.sessionKey };
  if (candidate.kind === 'project_context' && context.projectId) return { type: 'project', id: context.projectId };
  if ((candidate.kind === 'project_context' || candidate.kind === 'task_lesson') && context.workspaceId) {
    return { type: 'workspace', id: context.workspaceId };
  }
  return { type: 'global' };
}

export class UserUnderstandingService {
  async applyCandidates(candidates: UnderstandingCandidate[], context: {
    sessionKey?: string;
    workspaceId?: string;
    projectId?: string;
    sourceItemId?: string;
    sourceItemIds?: string[];
    sourceText?: string;
    source?: { provider?: string; sourceInstanceId?: string };
    evidenceIds?: string[];
    reviewSource?: 'turn' | 'background';
    supersedesRecordIds?: string[];
    extractionRunId?: string;
  }): Promise<Omit<UnderstandingReviewResult, 'sourceItemId'>> {
    let created = 0;
    let deduplicated = 0;
    const createdRecords: UnderstandingReviewResult['createdRecords'] = [];
    const writeOutputs: NonNullable<UnderstandingReviewResult['writeOutputs']> = [];
    const correctionTarget = context.supersedesRecordIds?.length === 1 ? context.supersedesRecordIds[0] : undefined;
    const extractionRun = context.extractionRunId ? getContextExtractionRun(context.extractionRunId) : null;
    if (context.extractionRunId && !extractionRun) throw new Error('Context extraction run not found');
    if (context.source?.provider && !extractionRun) throw new Error('External understanding requires an extraction run');
    const extractionDefinition = extractionRun
      ? getRegisteredExtractorDefinition(extractionRun.extractorId)
      : undefined;
    const considered = candidates.slice(0, 10);
    const prepared = considered.map((candidate) => {
      const content = normalizeContent(candidate.content);
      const sensitivity = effectiveSensitivity(candidate.sensitivity, content);
      const scope = scopeForCandidate(candidate, context);
      const key = candidate.canonicalKey ?? canonicalUnderstandingKey(candidate.kind, content);
      const explicitness = extractionDefinition?.authorityCeiling === 'user_explicit'
        ? candidate.explicitness
        : extractionDefinition?.authorityCeiling === 'user_observed'
          ? candidate.explicitness === 'explicit' ? 'observed' : candidate.explicitness
          : extractionDefinition ? 'inferred' : candidate.explicitness;
      return { candidate, content, sensitivity, scope, key, explicitness };
    });
    const eligible = prepared.filter(({ candidate, content, sensitivity, scope, key }) =>
      content.length >= 4
      && candidate.confidence >= 0.55
      && sensitivity !== 'secret'
      && sensitivity !== 'regulated'
      && (!extractionDefinition || extractionDefinition.candidateKinds.includes(candidate.kind))
      && !isUnderstandingSuppressed(key, scope));
    let rejected = candidates.length - eligible.length;
    for (const item of prepared.filter((candidate) => !eligible.includes(candidate))) {
      writeOutputs.push({ candidateKey: item.key, outcome: 'rejected' });
    }
    if (!eligible.length) {
      return { proposed: candidates.length, created, deduplicated, rejected, createdRecords, writeOutputs };
    }
    const evidenceIds = [...new Set(context.evidenceIds ?? [])];
    const sourceItemIds = [context.sourceItemId, ...(context.sourceItemIds ?? [])]
      .filter((value): value is string => Boolean(value));
    for (const sourceItemId of [...new Set(sourceItemIds)]) {
      const evidence = createContextEvidence({
        sourceType: context.source?.provider ? 'connector' : 'runtime',
        ...(context.source?.sourceInstanceId ? { sourceInstanceId: context.source.sourceInstanceId } : {}),
        sourceRef: sourceItemId,
        ...(context.extractionRunId ? { sourceRunId: context.extractionRunId } : {}),
        sourceItemId,
        retentionPolicy: 'derived_only',
        ...(extractionRun ? { processingPolicy: extractionRun.processingPolicy } : {}),
        ...(extractionRun ? { extractorId: extractionRun.extractorId, extractorVersion: extractionRun.extractorVersion } : {}),
        ...(context.sourceText ? { redactedExcerpt: redactSensitiveMemoryText(context.sourceText).slice(0, MAX_CANDIDATE_CHARS) } : {}),
        trustLevel: context.source?.provider ? 'untrusted' : 'trusted',
        observedAt: Date.now(),
      });
      evidenceIds.push(evidence.id);
    }

    for (const { candidate, content, sensitivity, scope, key, explicitness } of eligible) {
      const duplicate = findDuplicateUnderstanding(listUnderstandings(), {
        kind: candidate.kind,
        statement: content,
        canonicalKey: key,
        scope,
      });
      if (duplicate) {
        for (const evidenceId of evidenceIds) linkUnderstandingEvidence(duplicate.versionId, evidenceId, 'supports', candidate.confidence);
        deduplicated += 1;
        writeOutputs.push({
          candidateKey: key, objectId: duplicate.id, versionId: duplicate.versionId, outcome: 'deduplicated',
        });
        continue;
      }
      const isExplicit = explicitness === 'explicit' && extractionDefinition?.maxAutomaticStatus !== 'candidate';
      const contradiction = findContradictoryUnderstanding(listUnderstandings(), {
        kind: candidate.kind, statement: content, scope,
      });
      const supersededId = isExplicit ? correctionTarget ?? contradiction?.id : undefined;
      const validFrom = candidateTime(candidate.validFrom);
      const validTo = candidateTime(candidate.validTo);
      const record = createUnderstanding({
        kind: candidate.kind,
        canonicalKey: key,
        status: isExplicit ? 'active' : 'candidate',
        scope,
        explicitness,
        durability: candidate.durability,
        sensitivity,
        disclosurePolicy: candidate.disclosurePolicy,
        confidence: candidate.confidence,
        statement: content,
        payload: candidate.payload,
        createdBy: context.reviewSource === 'background' ? 'consolidation' : 'runtime',
        changeReason: context.reviewSource === 'background' ? 'background synthesis' : 'explicit user statement',
        ...(validFrom !== undefined ? { validFrom } : {}),
        ...(validTo !== undefined ? { validTo } : {}),
        ...(supersededId ? { supersedesId: supersededId } : {}),
      });
      for (const evidenceId of evidenceIds) linkUnderstandingEvidence(record.versionId, evidenceId, 'supports', candidate.confidence);
      const relationTarget = supersededId ? getUnderstanding(supersededId) : contradiction;
      if (relationTarget) {
        linkContextObjects({
          subjectType: 'understanding', subjectId: record.id, subjectVersionId: record.versionId,
          predicate: supersededId ? 'supersedes' : 'contradicts',
          objectType: 'understanding', objectId: relationTarget.id, objectVersionId: relationTarget.versionId,
          factual: true, ...(context.extractionRunId ? { extractionRunId: context.extractionRunId } : {}),
        });
      }
      if (supersededId && isExplicit) {
        const closedAt = record.validFrom ?? Date.now();
        closeUnderstandingValidity(supersededId, closedAt);
        closeTemporalAssertions({ objectType: 'understanding', objectId: supersededId, validTo: closedAt });
        setUnderstandingStatus(supersededId, 'archived', {
          actorType: 'user', source: 'semantic-memory-superseded',
        });
      }
      const assertionType = record.kind === 'current_state' ? 'current_state'
        : record.kind === 'routine' ? 'routine'
          : record.kind === 'relationship' ? 'relationship'
            : record.kind === 'project_context' ? 'project_status' : undefined;
      if (assertionType) {
        createTemporalAssertion({
          objectType: 'understanding', objectId: record.id, objectVersionId: record.versionId,
          assertionType, value: { statement: record.statement }, confidence: record.confidence,
          ...(record.validFrom ? { validFrom: record.validFrom } : {}),
          ...(record.validTo ? { validTo: record.validTo } : {}),
          status: record.status === 'active' ? 'active' : 'candidate',
          ...(context.extractionRunId ? { extractionRunId: context.extractionRunId } : {}),
        });
      }
      created += 1;
      createdRecords.push({ id: record.id, content: record.statement, kind: record.kind, status: record.status });
      writeOutputs.push({ candidateKey: key, objectId: record.id, versionId: record.versionId, outcome: 'created' });
    }
    return { proposed: candidates.length, created, deduplicated, rejected, createdRecords, writeOutputs };
  }
}
