import {
  closeTemporalAssertions,
  closeUnderstandingValidity,
  createTemporalAssertion,
  createContextEvidence,
  createUnderstanding,
  finishContextExtractionRun,
  getUnderstanding,
  getContextExtractionRun,
  isUnderstandingSuppressed,
  linkUnderstandingEvidence,
  linkContextObjects,
  listContextExtractionOutputs,
  listUnderstandings,
  setUnderstandingStatus,
} from '../../../storage/sqlite/index.js';
import {
  claimRegisteredExtraction,
  extractionInputHash,
  getRegisteredExtractorDefinition,
} from '../../../user-context/extraction/registry.js';
import type { UnderstandingKind, UserContextScope } from '../../../user-context/domain.js';
import {
  canonicalUnderstandingKey,
  findContradictoryUnderstanding,
  findDuplicateUnderstanding,
} from '../../../user-context/understanding.js';
import { inferMemorySensitivity, redactSensitiveMemoryText } from '../sensitivity.js';
import { extractExplicitUnderstandingCorrectionContent } from './correction.js';
import type { UnderstandingCandidate, UnderstandingReviewResult } from './types.js';

const MAX_CANDIDATE_CHARS = 600;
const EXPLICIT_PATTERNS = [
  /\b(?:please\s+)?remember(?:\s+that)?\s+(.+)/i,
  /\bkeep\s+in\s+mind(?:\s+that)?\s+(.+)/i,
  /(?:请)?记住[：:\s]*(.+)/,
];
const HIGH_SIGNAL_PATTERNS = [
  /(?:从现在起|今后|以后)(?:都)?(?:请)?[：:\s]*(.+)/,
  /下次(?:请)?[：:\s]*(.+)/,
  /(?:默认|每次|每回)(?:都)?(?:请)?[：:\s]*(.+)/,
  /((?:我|本人)(?:一直|通常|一般|更)?(?:喜欢|偏好|习惯|希望|不希望|不喜欢).+)/,
  /\b(?:from now on|going forward|next time|by default|whenever)\b[,:\s]*(.+)/i,
  /(\bi\s+(?:always|usually|generally)\s+(?:prefer|like|want|need|avoid)\b.+)/i,
  /(\bi\s+(?:prefer|like|want|need)\s+.+\s+(?:every time|by default|going forward)\b.*)/i,
];
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

function inferKind(content: string): UnderstandingKind {
  if (/\b(don't|do not|never|avoid)\b/i.test(content) || /不要|不用|无需|别再|禁止|底线/.test(content)) return 'boundary';
  if (/\b(prefer|preference|like)\b/i.test(content) || /喜欢|偏好|习惯/.test(content)) return 'preference';
  if (/\b(project|repo|codebase|workspace)\b/i.test(content) || /项目|仓库|代码库/.test(content)) return 'project_context';
  if (/\b(goal|plan|deadline)\b/i.test(content) || /目标|计划|截止/.test(content)) return 'long_term_goal';
  if (/\b(next time|lesson|failed|error)\b/i.test(content) || /教训|失败|错误/.test(content)) return 'task_lesson';
  if (/习惯|每周|每天|usually|routine/i.test(content)) return 'routine';
  return 'current_state';
}

export function extractExplicitUnderstandingCandidates(userContent: string): UnderstandingCandidate[] {
  const correction = extractExplicitUnderstandingCorrectionContent(userContent);
  const matched = correction ?? userContent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .flatMap((line) => EXPLICIT_PATTERNS.map((pattern) => pattern.exec(line)?.[1] ?? ''))
    .map(normalizeContent)
    .find((content) => content.length >= 8);
  if (!matched) return [];
  const content = normalizeContent(matched);
  const kind = inferKind(content);
  return [{
    kind,
    content,
    canonicalKey: canonicalUnderstandingKey(kind, content),
    confidence: correction ? 0.98 : 0.95,
    importance: kind === 'boundary' ? 0.9 : 0.8,
    explicitness: 'explicit',
    durability: 'durable',
    sensitivity: inferMemorySensitivity(content),
    disclosurePolicy: kind === 'boundary' ? 'silent' : 'referenceable',
  }];
}

export function extractHighSignalUnderstandingCandidates(userContent: string): UnderstandingCandidate[] {
  if (extractExplicitUnderstandingCorrectionContent(userContent)) return [];
  const matched = userContent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .flatMap((line) => HIGH_SIGNAL_PATTERNS.map((pattern) => pattern.exec(line)?.[1] ?? ''))
    .map(normalizeContent)
    .find((content) => content.length >= 6);
  if (!matched) return [];
  const kind = inferKind(matched);
  return [{
    kind,
    content: matched,
    canonicalKey: canonicalUnderstandingKey(kind, matched),
    confidence: 0.85,
    importance: kind === 'boundary' ? 0.9 : 0.75,
    explicitness: 'observed',
    durability: 'durable',
    sensitivity: inferMemorySensitivity(matched),
    disclosurePolicy: kind === 'boundary' ? 'silent' : 'referenceable',
  }];
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
  async reviewTurn(params: {
    userContent: string;
    assistantContent: string;
    sessionKey?: string;
    turnId?: string;
    workspaceId?: string;
    projectId?: string;
    correctionTargetRecordIds?: string[];
  }): Promise<UnderstandingReviewResult> {
    void params.assistantContent;
    const explicitCandidates = extractExplicitUnderstandingCandidates(params.userContent);
    const candidates = explicitCandidates.length > 0
      ? explicitCandidates
      : extractHighSignalUnderstandingCandidates(params.userContent);
    const turnRef = params.turnId ?? `untracked-${extractionInputHash(params.userContent).slice(0, 16)}`;
    const extraction = claimRegisteredExtraction({
      extractorId: explicitCandidates.length > 0 ? 'explicit-command' : 'deterministic-signal',
      sourceRef: params.sessionKey
        ? `session:${params.sessionKey}:turn:${turnRef}`
        : `turn:${turnRef}`,
      contentForHash: params.userContent,
      processingPolicy: 'local_only',
      destination: 'deterministic',
    });
    if (!extraction.shouldExecute) {
      const previous = listContextExtractionOutputs(extraction.run.id);
      return {
        proposed: candidates.length, created: 0,
        deduplicated: previous.filter((output) => output.outcome !== 'rejected').length,
        rejected: previous.filter((output) => output.outcome === 'rejected').length,
        createdRecords: [],
      };
    }
    if (candidates.length === 0) {
      finishContextExtractionRun({ runId: extraction.run.id, status: 'completed', outputs: [] });
      return { proposed: 0, created: 0, deduplicated: 0, rejected: 0, createdRecords: [] };
    }
    const safeCandidates = candidates.filter((candidate) => {
      const content = normalizeContent(candidate.content);
      const sensitivity = effectiveSensitivity(candidate.sensitivity, content);
      return sensitivity !== 'secret' && sensitivity !== 'regulated';
    });
    if (!safeCandidates.length) {
      finishContextExtractionRun({
        runId: extraction.run.id, status: 'completed',
        outputs: candidates.map((candidate) => ({
          candidateKey: candidate.canonicalKey ?? canonicalUnderstandingKey(candidate.kind, candidate.content),
          outcome: 'rejected',
        })),
      });
      return { proposed: candidates.length, created: 0, deduplicated: 0, rejected: candidates.length, createdRecords: [] };
    }
    const evidence = createContextEvidence({
      sourceType: 'conversation',
      sourceRef: params.sessionKey
        ? `session:${params.sessionKey}:turn:${turnRef}`
        : `turn:${turnRef}`,
      sourceRunId: extraction.run.id,
      ...(params.sessionKey ? { sessionId: params.sessionKey } : {}),
      turnId: turnRef,
      contentHash: extractionInputHash(params.userContent),
      retentionPolicy: 'derived_only',
      processingPolicy: 'local_only',
      extractorId: extraction.run.extractorId,
      extractorVersion: extraction.run.extractorVersion,
      redactedExcerpt: redactSensitiveMemoryText(safeCandidates.map((candidate) => candidate.content).join('\n'))
        .slice(0, MAX_CANDIDATE_CHARS),
      trustLevel: 'owner',
      observedAt: Date.now(),
    });
    let result: Awaited<ReturnType<UserUnderstandingService['applyCandidates']>>;
    try {
      result = await this.applyCandidates(safeCandidates, {
        sessionKey: params.sessionKey,
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        evidenceIds: [evidence.id],
        reviewSource: 'turn',
        supersedesRecordIds: params.correctionTargetRecordIds,
        extractionRunId: extraction.run.id,
      });
    } catch (error) {
      finishContextExtractionRun({ runId: extraction.run.id, status: 'failed', errorCode: 'write_failed' });
      throw error;
    }
    finishContextExtractionRun({
      runId: extraction.run.id, status: 'completed',
      outputs: result.writeOutputs?.map((output) => ({
        candidateKey: output.candidateKey, objectType: output.objectId ? 'understanding' : undefined,
        objectId: output.objectId, versionId: output.versionId, outcome: output.outcome,
      })) ?? [],
    });
    return {
      ...result,
      proposed: candidates.length,
      rejected: result.rejected + candidates.length - safeCandidates.length,
      sourceItemId: evidence.id,
    };
  }

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
        setUnderstandingStatus(supersededId, 'archived');
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
