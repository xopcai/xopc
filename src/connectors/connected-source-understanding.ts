import type { Config } from '../config/schema.js';
import { writeKnowledgeItem } from '../knowledge-memory/index.js';
import type { KnowledgeSourceItem } from '../knowledge/types.js';
import {
  finishContextExtractionRun,
  listKnowledgeSourceItems,
} from '../storage/sqlite/index.js';
import { createContextEvidence } from '../storage/sqlite/context-evidence-repository.js';
import { reconcileAssertion } from '../user-model/index.js';
import { claimRegisteredExtraction } from '../user-context/extraction/registry.js';
import type { UnderstandingSourceItem } from '../user-context/sources/types.js';
import { allowsRemoteSourceProcessing } from '../user-context/sources/processing-policy.js';
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

function itemType(value: string): UnderstandingSourceItem['type'] {
  if (value === 'email') return 'mail';
  if (value === 'calendar_event') return 'calendar_event';
  if (value === 'external_task') return 'task';
  if (value === 'development_activity' || value === 'repository') return 'code_activity';
  return 'document';
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function connectedItemsForUnderstanding(items: KnowledgeSourceItem[]): UnderstandingSourceItem[] {
  return [...items]
    .sort((left, right) => Number(right.itemType === 'connected_content') - Number(left.itemType === 'connected_content'))
    .slice(0, MAX_CONNECTED_ITEMS).flatMap((item) => {
    const value = normalizedValue(item);
    const title = text(value.title) ?? text(value.subject) ?? text(value.fullName)
      ?? text(value.repository) ?? `${text(item.metadata.toolkit) ?? 'Connected source'} ${item.itemType}`;
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

type PortraitCandidate = WorkDiscoveryProfileCandidate & { category: 'preference' | 'routine' | 'communication' };

function isPortraitCandidate(candidate: WorkDiscoveryProfileCandidate): candidate is PortraitCandidate {
  return candidate.category === 'preference'
    || candidate.category === 'routine'
    || candidate.category === 'communication';
}

function durableEvidence(candidate: PortraitCandidate, items: Map<string, UnderstandingSourceItem>) {
  const evidence = [...new Set(candidate.evidenceRefs ?? [])].flatMap((ref) => items.get(ref) ?? []);
  const required = candidate.category === 'routine' ? 3 : 2;
  const dates = new Set(evidence.map((item) => item.occurredAt ?? item.modifiedAt)
    .filter((value): value is number => value !== undefined)
    .map((value) => new Date(value).toISOString().slice(0, 10)));
  return candidate.confidence === 'high' && evidence.every((item) => item.ownerAttribution === 'user')
    && evidence.length >= required && dates.size >= required ? evidence : [];
}

export async function deriveConnectedSourceUnderstanding(input: {
  config: Config;
  agentId: string;
  sourceInstanceId: string;
  sourceRunId: string;
  processingPolicy: 'local_only' | 'remote_allowed';
  analyze?: typeof analyzeUnderstandingSources;
}): Promise<{
  created: number;
  knowledgeCount: number;
  status: 'completed' | 'partial' | 'failed';
  error?: string;
}> {
  const sourceItems = listKnowledgeSourceItems({
    agentId: input.agentId,
    sourceInstanceId: input.sourceInstanceId,
    includeDeleted: false,
    limit: MAX_CONNECTED_ITEMS,
  });
  const items = connectedItemsForUnderstanding(sourceItems);
  if (!items.length) return { created: 0, knowledgeCount: 0, status: 'completed' };
  const extraction = claimRegisteredExtraction({
    extractorId: 'connector-semantic',
    sourceRef: `understanding-source-run:${input.sourceRunId}`,
    contentForHash: sourceItems.map((item) => `${item.id}:${item.sourceUpdatedAt ?? ''}`).join('\n'),
    processingPolicy: input.processingPolicy,
    destination: 'remote_model',
  });
  if (!allowsRemoteSourceProcessing([input.processingPolicy]) || !extraction.shouldExecute) {
    return { created: 0, knowledgeCount: 0, status: 'completed' };
  }
  try {
    const analysis = await (input.analyze ?? analyzeUnderstandingSources)({ config: input.config, items });
    const byRef = new Map(items.map((item) => [item.evidenceRef, item]));
    let created = 0;
    for (const candidate of analysis.profileCandidates.filter(isPortraitCandidate)) {
      const evidenceItems = durableEvidence(candidate, byRef);
      if (!evidenceItems.length) continue;
      for (const [index, evidenceItem] of evidenceItems.entries()) {
        const evidence = createContextEvidence({
          sourceType: 'connector',
          sourceInstanceId: input.sourceInstanceId,
          sourceRef: evidenceItem.evidenceRef,
          redactedExcerpt: evidenceItem.title.slice(0, 600),
          trustLevel: 'owner',
          observedAt: evidenceItem.occurredAt ?? evidenceItem.modifiedAt ?? Date.now(),
        });
        const result = reconcileAssertion({
          subject: { type: 'user', id: 'self' },
          predicate: `${candidate.category}.connected.${candidate.factKey}`,
          cardinality: 'single',
          scope: { type: 'global' },
          kind: candidate.category === 'communication' ? 'preference' : candidate.category,
          value: candidate.statement,
          normalizedValue: candidate.statement.toLocaleLowerCase(),
          statement: candidate.statement,
          authority: 'user_observed',
          confidence: candidate.confidence === 'high' ? 0.9 : 0.7,
          inferredImportance: 0.65,
          consequence: 'medium',
          actionability: 0.6,
          volatility: candidate.category === 'routine' || candidate.category === 'communication' ? 'slow' : 'stable',
          sensitivity: 'normal',
          disclosurePolicy: 'referenceable',
          observedAt: evidenceItem.occurredAt ?? evidenceItem.modifiedAt ?? Date.now(),
          createdBy: 'connector',
          evidenceId: evidence.id,
          evidenceConfidence: 0.9,
        });
        if (index === 0 && result.action === 'created') created += 1;
      }
    }
    let knowledgeCount = 0;
    for (const thread of analysis.workThreadCandidates) {
      const result = writeKnowledgeItem({
        kind: 'project_fact',
        scope: { type: 'agent', id: input.agentId },
        content: `${thread.title}: ${thread.summary}`,
        canonicalKey: `connected-thread:${input.sourceInstanceId}:${thread.topicKey}`,
        confidence: thread.confidence === 'high' ? 0.9 : thread.confidence === 'medium' ? 0.72 : 0.55,
        importance: thread.horizon === 'current' ? 0.75 : 0.5,
        originClass: 'untrusted',
        sourceAgentId: input.agentId,
        source: { sourceRunId: input.sourceRunId, evidenceRefs: thread.evidenceRefs },
      });
      if (result.created) knowledgeCount += 1;
    }
    finishContextExtractionRun({ runId: extraction.run.id, status: 'completed' });
    const sourceStatus = analysis.sourceStatuses.find((item) => item.sourceId === 'connected-work');
    return {
      created,
      knowledgeCount,
      status: sourceStatus?.status ?? 'failed',
      ...(sourceStatus?.error ? { error: sourceStatus.error } : {}),
    };
  } catch (error) {
    finishContextExtractionRun({ runId: extraction.run.id, status: 'failed', errorCode: 'extractor_failed' });
    throw error;
  }
}
