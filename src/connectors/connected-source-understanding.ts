import { createHash } from 'node:crypto';

import type { MemoryManager } from '../agent/memory/manager.js';
import type { UnderstandingCandidate } from '../agent/memory/understanding/types.js';
import type { Config } from '../config/schema.js';
import type { KnowledgeSourceItem } from '../knowledge/types.js';
import { listKnowledgeSourceItems } from '../storage/sqlite/index.js';
import { finishContextExtractionRun } from '../storage/sqlite/index.js';
import { claimRegisteredExtraction } from '../user-context/extraction/registry.js';
import type { UnderstandingSourceItem } from '../user-context/sources/types.js';
import { allowsRemoteSourceProcessing } from '../user-context/sources/processing-policy.js';
import { upsertUserFocus } from '../user-context/sources/repository.js';
import { analyzeUnderstandingSources } from '../work-discovery/analyzer.js';
import type { WorkDiscoveryProfileCandidate } from '../work-discovery/types.js';

const MAX_CONNECTED_ITEMS = 150;

function normalizedValue(item: KnowledgeSourceItem): Record<string, unknown> {
  if (!item.normalizedText) return {};
  try {
    const value = JSON.parse(item.normalizedText) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function itemType(itemType: string): UnderstandingSourceItem['type'] {
  if (itemType === 'email') return 'mail';
  if (itemType === 'calendar_event') return 'calendar_event';
  if (itemType === 'external_task') return 'task';
  if (itemType === 'development_activity' || itemType === 'repository') return 'code_activity';
  return 'document';
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function contentPriority(item: KnowledgeSourceItem): number {
  const value = normalizedValue(item);
  if (item.itemType === 'connected_content') return 3;
  if (text(value.content)) return 2;
  return 1;
}

export function connectedItemsForUnderstanding(items: KnowledgeSourceItem[]): UnderstandingSourceItem[] {
  return [...items]
    .sort((left, right) => contentPriority(right) - contentPriority(left))
    .slice(0, MAX_CONNECTED_ITEMS)
    .flatMap((item) => {
      const value = normalizedValue(item);
      const title = text(value.title)
        ?? text(value.subject)
        ?? text(value.fullName)
        ?? text(value.repository)
        ?? `${text(item.metadata.toolkit) ?? 'Connected source'} ${item.itemType}`;
      const normalizedText = item.normalizedText?.trim();
      if (!title && !normalizedText) return [];
      return [{
        id: item.id,
        sourceId: 'connected-work',
        type: itemType(item.itemType),
        title,
        ...(normalizedText ? { text: normalizedText.slice(0, 24_000) } : {}),
        ...(text(item.metadata.toolkit) ? { group: text(item.metadata.toolkit) } : {}),
        ...(timestamp(item.occurredAt) ? { occurredAt: timestamp(item.occurredAt) } : {}),
        ...(timestamp(item.sourceUpdatedAt) ? { modifiedAt: timestamp(item.sourceUpdatedAt) } : {}),
        ownerAttribution: item.metadata.actorAttributed === true ? 'user' : 'shared',
        sensitivity: item.sensitivity,
        evidenceRef: `knowledge-source://${item.id}`,
      } satisfies UnderstandingSourceItem];
    });
}

function understandingKind(category: WorkDiscoveryProfileCandidate['category']): UnderstandingCandidate['kind'] {
  if (category === 'preference') return 'preference';
  if (category === 'workflow') return 'routine';
  if (category === 'focus') return 'current_state';
  return 'project_context';
}

function understandingCandidate(candidate: WorkDiscoveryProfileCandidate): UnderstandingCandidate {
  const normalized = candidate.statement.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return {
    kind: understandingKind(candidate.category),
    content: candidate.statement,
    canonicalKey: `connected-semantic:${candidate.category}:${createHash('sha256').update(normalized).digest('hex').slice(0, 20)}`,
    confidence: candidate.confidence === 'high' ? 0.9 : candidate.confidence === 'medium' ? 0.72 : 0.55,
    importance: candidate.category === 'focus' ? 0.8 : 0.68,
    explicitness: 'inferred',
    durability: candidate.category === 'focus' ? 'ephemeral' : candidate.category === 'workflow' ? 'recurring' : 'durable',
    sensitivity: 'personal',
    disclosurePolicy: 'referenceable',
  };
}

function hasLongVerbatimOverlap(value: string, sourceTexts: string[], minimumLength = 32): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length < minimumLength) return false;
  return sourceTexts.some((source) => source.replace(/\s+/g, ' ').includes(normalized));
}

export async function deriveConnectedSourceUnderstanding(input: {
  config: Config;
  agentId: string;
  sourceInstanceId: string;
  sourceRunId: string;
  processingPolicy: 'local_only' | 'remote_allowed';
  memoryManager: MemoryManager;
  analyze?: typeof analyzeUnderstandingSources;
}): Promise<{
  created: number;
  focusCount: number;
  status: 'completed' | 'partial' | 'failed';
  error?: string;
}> {
  const knowledgeItems = listKnowledgeSourceItems({
    agentId: input.agentId,
    sourceInstanceId: input.sourceInstanceId,
    includeDeleted: false,
    limit: MAX_CONNECTED_ITEMS,
  });
  const items = connectedItemsForUnderstanding(knowledgeItems);
  if (!items.length) return { created: 0, focusCount: 0, status: 'completed' };
  const extraction = claimRegisteredExtraction({
    extractorId: 'connector-semantic', sourceRef: `understanding-source-run:${input.sourceRunId}`,
    contentForHash: knowledgeItems.map((item) => `${item.id}:${item.sourceUpdatedAt ?? ''}`).join('\n'),
    processingPolicy: input.processingPolicy, destination: 'remote_model',
  });
  if (!allowsRemoteSourceProcessing([input.processingPolicy]) || !extraction.shouldExecute) {
    return { created: 0, focusCount: 0, status: 'completed' };
  }
  try {
    const analysis = await (input.analyze ?? analyzeUnderstandingSources)({ config: input.config, items });
  const rawTexts = items.flatMap((item) => item.text ? [item.text] : []);
  const profileCandidates = analysis.profileCandidates
    .filter((candidate) => !hasLongVerbatimOverlap(candidate.statement, rawTexts));
  const sourceItemIds = [...new Set([
    ...profileCandidates.flatMap((candidate) => candidate.evidenceRefs ?? []),
    ...analysis.workThreadCandidates.flatMap((candidate) => candidate.evidenceRefs),
  ].map((ref) => ref.startsWith('knowledge-source://') ? ref.slice('knowledge-source://'.length) : ''))]
    .filter(Boolean)
    .slice(0, 20);
    const reviewed = profileCandidates.length
      ? await input.memoryManager.applyUnderstandingCandidates(
        profileCandidates.map(understandingCandidate),
        {
          agentId: input.agentId,
          sourceItemIds,
          sourceText: 'Bounded semantic synthesis from explicitly connected work sources.',
          source: { provider: 'connected-sources', sourceInstanceId: input.sourceInstanceId },
          reviewSource: 'background',
          extractionRunId: extraction.run.id,
        },
      )
      : { created: 0, writeOutputs: [] };
    const focuses = analysis.workThreadCandidates
    .filter((candidate) => !hasLongVerbatimOverlap(candidate.title, rawTexts)
      && !hasLongVerbatimOverlap(candidate.summary, rawTexts))
    .map((candidate) => upsertUserFocus({
      canonicalKey: `connected-focus:${candidate.topicKey}`,
      title: candidate.title,
      summary: candidate.summary,
      horizon: candidate.horizon,
      status: 'candidate',
      confidence: candidate.confidence === 'high' ? 0.9 : candidate.confidence === 'medium' ? 0.72 : 0.55,
      evidenceRefs: candidate.evidenceRefs,
      sourceRunId: input.sourceRunId,
    }));
    finishContextExtractionRun({
      runId: extraction.run.id, status: 'completed',
      outputs: [
        ...(reviewed.writeOutputs ?? []).map((output) => ({
          candidateKey: output.candidateKey,
          ...(output.objectId ? { objectType: 'understanding' as const, objectId: output.objectId } : {}),
          ...(output.versionId ? { versionId: output.versionId } : {}), outcome: output.outcome,
        })),
        ...focuses.map((focus) => ({
          candidateKey: focus.canonicalKey, objectType: 'focus' as const, objectId: focus.id,
          versionId: focus.versionId, outcome: 'created' as const,
        })),
      ],
    });
    const sourceStatus = analysis.sourceStatuses.find((item) => item.sourceId === 'connected-work');
    return {
      created: reviewed.created,
      focusCount: focuses.length,
      status: sourceStatus?.status ?? 'failed',
      ...(sourceStatus?.error ? { error: sourceStatus.error } : {}),
    };
  } catch (error) {
    finishContextExtractionRun({ runId: extraction.run.id, status: 'failed', errorCode: 'extractor_failed' });
    throw error;
  }
}
