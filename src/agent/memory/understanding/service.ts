import { createHash, randomUUID } from 'node:crypto';

import {
  appendMemoryTraceEvent,
  markMemoryRecordsConflicted,
  upsertKnowledgeSourceItems,
} from '../../../storage/sqlite/index.js';
import { createLogger } from '../../../utils/logger.js';
import type {
  MemoryEvidence,
  MemoryKind,
  MemoryRecord,
  MemorySensitivity,
  MemoryWriteRequest,
  MemoryWriteResult,
} from '../types.js';
import { nextMemoryReviewAt } from '../lifecycle.js';
import { extractExplicitUnderstandingCorrectionContent } from './correction.js';
import type { UnderstandingCandidate, UnderstandingReviewResult } from './types.js';
import { inferMemorySensitivity, redactSensitiveMemoryText } from '../sensitivity.js';

const log = createLogger('UserUnderstanding');
const MAX_CANDIDATE_CHARS = 600;

const EXPLICIT_PATTERNS: RegExp[] = [
  /\b(?:please\s+)?remember(?:\s+that)?\s+(.+)/i,
  /\bkeep\s+in\s+mind(?:\s+that)?\s+(.+)/i,
  /(?:请)?记住[：:\s]*(.+)/,
  /以后(?:都)?(?:请)?[：:\s]*(.+)/,
  /下次(?:请)?[：:\s]*(.+)/,
];

function normalizeContent(raw: string): string {
  return raw
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CANDIDATE_CHARS);
}

function inferKind(content: string): MemoryKind {
  if (/\b(don't|do not|never|avoid)\b/i.test(content) || /不要|别再|禁止|底线/.test(content)) {
    return 'boundary';
  }
  if (/\b(prefer|preference|like)\b/i.test(content) || /喜欢|偏好|习惯/.test(content)) {
    return 'preference';
  }
  if (/\b(tool|command|pnpm|npm|git|ripgrep|rg)\b/i.test(content) || /工具|命令/.test(content)) {
    return 'tool_preference';
  }
  if (/\b(project|repo|codebase|workspace)\b/i.test(content) || /项目|仓库|代码库/.test(content)) {
    return 'project_context';
  }
  if (/\b(goal|plan|commit|deadline)\b/i.test(content) || /目标|计划|承诺|截止/.test(content)) {
    return 'commitment';
  }
  if (/\b(next time|lesson|failed|error)\b/i.test(content) || /下次|教训|失败|错误/.test(content)) {
    return 'task_lesson';
  }
  return 'user_note';
}

const SENSITIVITY_RANK: Record<MemorySensitivity, number> = {
  normal: 0,
  personal: 1,
  regulated: 2,
  secret: 3,
};

function stricterSensitivity(content: string, declared: MemorySensitivity): MemorySensitivity {
  const inferred = inferMemorySensitivity(content);
  return SENSITIVITY_RANK[inferred] > SENSITIVITY_RANK[declared] ? inferred : declared;
}

function canonicalKey(kind: MemoryKind, content: string): string {
  const normalized = content
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return `${kind}:${createHash('sha256').update(normalized).digest('hex').slice(0, 20)}`;
}

export function extractExplicitUnderstandingCandidates(userContent: string): UnderstandingCandidate[] {
  const correction = extractExplicitUnderstandingCorrectionContent(userContent);
  if (correction) {
    const kind = inferKind(correction);
    return [{
      kind,
      content: correction,
      canonicalKey: canonicalKey(kind, correction),
      confidence: 0.95,
      importance: kind === 'boundary' ? 0.9 : 0.8,
      explicitness: 'explicit',
      durability: 'durable',
      sensitivity: inferMemorySensitivity(correction),
      disclosurePolicy: kind === 'boundary' ? 'silent' : 'referenceable',
      tags: ['user-understanding', 'explicit-user-correction'],
    }];
  }
  const lines = userContent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.length > 0 ? lines : [userContent.trim()]) {
    for (const pattern of EXPLICIT_PATTERNS) {
      const content = normalizeContent(pattern.exec(line)?.[1] ?? '');
      if (content.length < 8) continue;
      const kind = inferKind(content);
      return [{
        kind,
        content,
        canonicalKey: canonicalKey(kind, content),
        confidence: 0.92,
        importance: kind === 'boundary' ? 0.9 : 0.75,
        explicitness: 'explicit',
        durability: 'durable',
        sensitivity: inferMemorySensitivity(content),
        disclosurePolicy: kind === 'boundary' ? 'silent' : 'referenceable',
        tags: ['user-understanding', 'explicit-user-request'],
      }];
    }
  }
  return [];
}

export interface UserUnderstandingServiceOptions {
  write: (request: MemoryWriteRequest) => Promise<MemoryWriteResult>;
  list: (canonicalKey: string, scope: MemoryWriteRequest['scope']) => Promise<MemoryRecord[]>;
  attachEvidence?: (recordId: string, evidence: MemoryEvidence) => void;
}

function scopeForCandidate(
  candidate: UnderstandingCandidate,
  context: { sessionKey?: string; workspaceId?: string; projectId?: string },
): MemoryWriteRequest['scope'] {
  const base = { userId: 'local-owner' };
  if (candidate.durability === 'ephemeral') {
    return { ...base, ...(context.sessionKey ? { sessionKey: context.sessionKey } : {}) };
  }
  if (candidate.kind === 'project_context') {
    return {
      ...base,
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
      ...(context.projectId ? { projectId: context.projectId } : {}),
    };
  }
  if (candidate.kind === 'workspace_fact' || candidate.kind === 'task_lesson') {
    return { ...base, ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}) };
  }
  return base;
}

export class UserUnderstandingService {
  constructor(private readonly options: UserUnderstandingServiceOptions) {}

  async reviewTurn(params: {
    agentId?: string;
    userContent: string;
    assistantContent: string;
    sessionKey?: string;
    workspaceId?: string;
    projectId?: string;
    correctionTargetRecordIds?: string[];
  }): Promise<UnderstandingReviewResult> {
    const candidates = extractExplicitUnderstandingCandidates(params.userContent);
    const sourceText = `User:\n${params.userContent.trim()}\n\nAssistant:\n${params.assistantContent.trim()}`;
    const normalizedText = redactSensitiveMemoryText(sourceText);
    const contentHash = createHash('sha256').update(sourceText).digest('hex');
    const stored = upsertKnowledgeSourceItems([{
      sourceInstanceId: params.sessionKey ? `session:${params.sessionKey}` : 'session:unknown',
      collectionScope: 'conversation',
      externalId: contentHash,
      itemType: 'conversation_turn',
      authorRole: 'user',
      occurredAt: new Date().toISOString(),
      contentHash,
      normalizedText,
      metadata: params.sessionKey ? { sessionKey: params.sessionKey } : {},
      sensitivity: 'personal',
      retentionClass: 'bounded',
      synthesisStatus: 'pending',
    }]);
    const sourceItemId = stored.items[0]?.id;
    const result = await this.applyCandidates(candidates, {
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      sourceItemId,
      sourceText: params.userContent,
      reviewSource: 'turn',
      supersedesRecordIds: params.correctionTargetRecordIds,
    });
    return { ...result, sourceItemId };
  }

  async applyCandidates(
    candidates: UnderstandingCandidate[],
    context: {
      agentId?: string;
      sessionKey?: string;
      workspaceId?: string;
      projectId?: string;
      sourceItemId?: string;
      sourceItemIds?: string[];
      sourceText?: string;
      source?: MemoryRecord['source'];
      reviewSource?: 'turn' | 'background';
      supersedesRecordIds?: string[];
    },
  ): Promise<Omit<UnderstandingReviewResult, 'sourceItemId'>> {
    const startedAt = Date.now();
    let created = 0;
    let deduplicated = 0;
    let rejected = 0;
    const recordIds: string[] = [];
    const createdRecords: UnderstandingReviewResult['createdRecords'] = [];
    const correctionTargets = [...new Set(context.supersedesRecordIds ?? [])];
    const conflictGroupId = correctionTargets.length > 1 ? randomUUID() : undefined;
    if (conflictGroupId) markMemoryRecordsConflicted(correctionTargets, conflictGroupId);
    for (const candidate of candidates.slice(0, 10)) {
      const content = normalizeContent(candidate.content);
      const sensitivity = stricterSensitivity(content, candidate.sensitivity);
      if (
        content.length < 4
        || candidate.confidence < 0.55
        || sensitivity === 'secret'
        || sensitivity === 'regulated'
      ) {
        rejected += 1;
        continue;
      }
      const evidenceText = context.sourceText
        ? redactSensitiveMemoryText(context.sourceText).slice(0, MAX_CANDIDATE_CHARS)
        : undefined;
      const key = candidate.canonicalKey ?? canonicalKey(candidate.kind, content);
      const supersedesRecordId = correctionTargets.length === 1
        ? correctionTargets[0]
        : undefined;
      const scope = scopeForCandidate(candidate, context);
      const existing = await this.options.list(key, scope);
      const sourceItemIds = [...new Set([
        ...(context.sourceItemId ? [context.sourceItemId] : []),
        ...(context.sourceItemIds ?? []),
      ])];
      const evidence: MemoryEvidence[] = (sourceItemIds.length ? sourceItemIds : [undefined]).map((sourceItemId) => ({
        ...(sourceItemId ? { sourceItemId } : {}),
        relation: 'supports',
        ...(context.sessionKey ? { sessionKey: context.sessionKey } : {}),
        ...(evidenceText ? { sourceText: evidenceText } : {}),
        observedAt: new Date().toISOString(),
        confidence: candidate.confidence,
      }));
      if (existing[0]) {
        deduplicated += 1;
        recordIds.push(existing[0].id);
        for (const item of evidence) {
          this.options.attachEvidence?.(existing[0].id, item);
        }
        continue;
      }
      const write = await this.options.write({
        kind: candidate.kind,
        content,
        canonicalKey: key,
        scope,
        sourceAgentId: context.agentId,
        tags: [...new Set(['user-understanding', ...(candidate.tags ?? [])])],
        source: context.source ?? { provider: 'user-understanding' },
        confidence: candidate.confidence,
        status: 'candidate',
        sensitivity,
        explicitness: candidate.explicitness,
        durability: candidate.durability,
        importance: candidate.importance,
        disclosurePolicy: candidate.disclosurePolicy,
        evidence,
        validFrom: candidate.validFrom,
        validTo: candidate.validTo,
        reviewAfter: nextMemoryReviewAt({
          durability: candidate.durability,
          explicitness: candidate.explicitness,
        }),
        supersedesRecordId,
        conflictGroupId,
      });
      if (write.success) {
        created += 1;
        if (write.record) {
          recordIds.push(write.record.id);
          createdRecords.push({ id: write.record.id, content: write.record.content, kind: write.record.kind });
        }
      } else {
        rejected += 1;
        log.debug({ errorMessage: write.error, canonicalKey: key }, 'Understanding candidate was not stored');
      }
    }
    try {
      appendMemoryTraceEvent({
        sessionKey: context.sessionKey,
        phase: 'understanding',
        providerId: 'user-understanding',
        request: {
          ...(context.agentId ? { agentId: context.agentId } : {}),
          source: context.reviewSource ?? 'turn',
          proposed: candidates.length,
          created,
          deduplicated,
          rejected,
        },
        resultCount: created,
        selectedRecordIds: recordIds,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      log.debug({ err, sessionKey: context.sessionKey }, 'Understanding quality trace append failed');
    }
    return { proposed: candidates.length, created, deduplicated, rejected, createdRecords };
  }
}
