import { createHash } from 'node:crypto';

import type { Config } from '../config/schema.js';
import { writeKnowledgeItem } from '../knowledge-memory/index.js';
import type { KnowledgeSourceItem } from '../knowledge/types.js';
import {
  finishContextExtractionRun,
  getKnowledgeSourceItem,
  type ContextExtractionOutput,
} from '../storage/sqlite/index.js';
import { createContextEvidence } from '../storage/sqlite/context-evidence-repository.js';
import { reconcileAssertion } from '../user-model/index.js';
import { claimRegisteredExtraction } from '../user-context/extraction/registry.js';
import { getActiveUnderstandingConsent } from '../user-context/sources/consent-repository.js';
import { getUnderstandingSourceRun } from '../user-context/sources/repository.js';
import type { UnderstandingConsentReceipt, UnderstandingSourceItem } from '../user-context/sources/types.js';
import { allowsRemoteSourceProcessing } from '../user-context/sources/processing-policy.js';
import { analyzeUnderstandingSources } from '../work-discovery/analyzer.js';
import type { WorkDiscoveryProfileCandidate } from '../work-discovery/types.js';
import { createLogger } from '../utils/logger.js';
import { recordConnectedSourceObservations } from './connected-source-observations.js';

const MAX_CONNECTED_ITEMS = 150;
const log = createLogger('ConnectedSourceUnderstanding');

type ExtractionOutput = Omit<ContextExtractionOutput, 'id' | 'runId' | 'ordinal' | 'createdAt'>;

function evidenceKey(sourceInstanceId: string, evidenceRefs: string[]): string {
  const fingerprint = createHash('sha256').update([...evidenceRefs].sort().join('\n')).digest('hex').slice(0, 24);
  return `connected-thread:${sourceInstanceId}:${fingerprint}`;
}

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

const CONSENT_FIELD_KEYS: Record<string, Set<string>> = {
  title: new Set(['title', 'subject', 'name', 'fullName', 'repository']),
  content: new Set(['content', 'body', 'text', 'snippet', 'description', 'summary']),
  participants: new Set(['from', 'to', 'cc', 'bcc', 'sender', 'author', 'organizer', 'attendees', 'participants', 'assignee', 'owners']),
  status: new Set(['status', 'state', 'labels']),
  timestamps: new Set(['createdAt', 'updatedAt', 'modifiedAt', 'start', 'end', 'created_at', 'updated_at', 'modified_at']),
  owner_activity: new Set(['user', 'username', 'owner']),
};

function consentFilteredText(textValue: string | undefined, allowedFields: Set<string>): string | undefined {
  if (!textValue) return undefined;
  try {
    const parsed = JSON.parse(textValue) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const allowedKeys = new Set([...allowedFields].flatMap((field) => [...(CONSENT_FIELD_KEYS[field] ?? [])]));
    const filtered = Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([key]) => allowedKeys.has(key)));
    return Object.keys(filtered).length ? JSON.stringify(filtered) : undefined;
  } catch {
    return allowedFields.has('content') ? textValue.slice(0, 24_000) : undefined;
  }
}

function itemsAllowedByConsent(
  items: UnderstandingSourceItem[],
  consent: UnderstandingConsentReceipt | undefined,
): UnderstandingSourceItem[] {
  if (!consent) return [];
  const allowed = new Set(consent.allowedFields);
  return items.map((item) => {
    const filteredText = consentFilteredText(item.text, allowed);
    return ({
    id: item.id,
    sourceId: item.sourceId,
    type: item.type,
    title: allowed.has('title') ? item.title : item.type,
    ...(filteredText ? { text: filteredText } : {}),
    ...(allowed.has('owner_activity') ? { ownerAttribution: item.ownerAttribution } : { ownerAttribution: 'unknown' }),
    ...(allowed.has('timestamps') && item.occurredAt !== undefined ? { occurredAt: item.occurredAt } : {}),
    ...(allowed.has('timestamps') && item.modifiedAt !== undefined ? { modifiedAt: item.modifiedAt } : {}),
    ...(allowed.has('timestamps') && item.startsAt !== undefined ? { startsAt: item.startsAt } : {}),
    ...(allowed.has('timestamps') && item.endsAt !== undefined ? { endsAt: item.endsAt } : {}),
    ...(allowed.has('status') && item.group ? { group: item.group } : {}),
    evidenceRef: item.evidenceRef,
    sensitivity: item.sensitivity,
    });
  });
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

type PortraitCandidate = WorkDiscoveryProfileCandidate & {
  category: 'role' | 'responsibility' | 'capability' | 'preference' | 'routine' | 'communication';
};

function isPortraitCandidate(candidate: WorkDiscoveryProfileCandidate): candidate is PortraitCandidate {
  return candidate.category === 'role'
    || candidate.category === 'responsibility'
    || candidate.category === 'capability'
    || candidate.category === 'preference'
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

function candidatePolicy(candidate: PortraitCandidate): {
  domain: 'identity' | 'goals' | 'capabilities' | 'preferences' | 'behavior';
  sensitivity: 'normal' | 'personal' | 'regulated';
  sensitivityCategories: Array<'health' | 'financial' | 'political' | 'religious' | 'sexuality' | 'trauma' | 'credential'>;
} {
  const statement = candidate.statement.toLocaleLowerCase();
  const categories = [
    ['health', /\b(health|medical|diagnos|medication|therapy|disability)\b|健康|疾病|诊断|用药|治疗|残疾/i],
    ['financial', /\b(salary|income|debt|bank|account balance|credit card)\b|工资|收入|债务|银行|余额|信用卡/i],
    ['political', /\b(political|party|election|vote[dr]?)\b|政治|政党|选举|投票/i],
    ['religious', /\b(religio|church|mosque|temple|faith)\b|宗教|教会|清真寺|寺庙|信仰/i],
    ['sexuality', /\b(sexual|orientation|gender identity)\b|性取向|性别认同/i],
    ['trauma', /\b(trauma|abuse|assault)\b|创伤|虐待|侵害/i],
    ['credential', /\b(password|secret key|api key|token)\b|密码|密钥|令牌/i],
  ] as const;
  const sensitivityCategories = categories.filter(([, pattern]) => pattern.test(statement)).map(([name]) => name);
  return {
    domain: candidate.category === 'role' ? 'identity'
      : candidate.category === 'responsibility' ? 'goals'
        : candidate.category === 'capability' ? 'capabilities'
          : candidate.category === 'routine' ? 'behavior' : 'preferences',
    sensitivity: sensitivityCategories.length
      ? sensitivityCategories.includes('health') || sensitivityCategories.includes('financial') ? 'regulated' : 'personal'
      : 'normal',
    sensitivityCategories,
  };
}

export async function deriveConnectedSourceUnderstanding(input: {
  config: Config;
  agentId: string;
  sourceInstanceId: string;
  sourceItemIds: string[];
  sourceRunId: string;
  processingPolicy: 'local_only' | 'remote_allowed';
  analyze?: typeof analyzeUnderstandingSources;
  assertAuthorized?: () => void;
}): Promise<{
  created: number;
  knowledgeCount: number;
  status: 'completed' | 'partial' | 'failed';
  error?: string;
}> {
  const sourceItems = [...new Set(input.sourceItemIds)].slice(0, MAX_CONNECTED_ITEMS)
    .flatMap((itemId) => getKnowledgeSourceItem(itemId) ?? [])
    .filter((item) => item.sourceInstanceId === input.sourceInstanceId
      && item.metadata.agentId === input.agentId && !item.deletedAt);
  const items = connectedItemsForUnderstanding(sourceItems);
  if (!items.length) {
    log.info({
      sourceRunId: input.sourceRunId,
      sourceInstanceId: input.sourceInstanceId,
      sourceItemCount: 0,
      reason: 'no_changed_items',
    }, 'Connected source semantic analysis skipped');
    return { created: 0, knowledgeCount: 0, status: 'completed' };
  }
  const sourceRun = getUnderstandingSourceRun(input.sourceRunId);
  const consentReceipt = sourceRun
    ? getActiveUnderstandingConsent(sourceRun.grantId) ?? undefined
    : undefined;
  const modelItems = itemsAllowedByConsent(items, consentReceipt);
  recordConnectedSourceObservations({
    items: sourceItems, consent: consentReceipt, sourceGrantId: sourceRun?.grantId,
  });
  const effectiveProcessingPolicy = input.processingPolicy === 'remote_allowed'
    && consentReceipt?.processingPolicy === 'remote_allowed'
    ? 'remote_allowed' as const
    : 'local_only' as const;
  const extraction = claimRegisteredExtraction({
    extractorId: 'connector-semantic',
    sourceRef: `understanding-source-run:${input.sourceRunId}`,
    contentForHash: sourceItems.map((item) => `${item.id}:${item.contentHash}`).join('\n'),
    processingPolicy: effectiveProcessingPolicy,
    destination: 'remote_model',
  });
  if (!allowsRemoteSourceProcessing([effectiveProcessingPolicy]) || !extraction.shouldExecute) {
    return { created: 0, knowledgeCount: 0, status: 'completed' };
  }
  try {
    const analysis = await (input.analyze ?? analyzeUnderstandingSources)({ config: input.config, items: modelItems });
    input.assertAuthorized?.();
    const byRef = new Map(modelItems.map((item) => [item.evidenceRef, item]));
    const outputs: ExtractionOutput[] = [];
    let created = 0;
    for (const candidate of analysis.profileCandidates.filter(isPortraitCandidate)) {
      const policy = candidatePolicy(candidate);
      const evidenceItems = durableEvidence(candidate, byRef);
      const candidateKey = `connected-profile:${candidate.category}:${candidate.factKey}`;
      if (!evidenceItems.length || !consentReceipt
        || !consentReceipt.allowedDomains.includes(policy.domain)
        || consentReceipt.deniedDomains.includes(policy.domain)) {
        outputs.push({ candidateKey, outcome: 'rejected' });
        continue;
      }
      let assertionId: string | undefined;
      let candidateCreated = false;
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
          kind: candidate.category === 'role' ? 'identity'
            : candidate.category === 'responsibility' ? 'derived_insight'
              : candidate.category === 'communication' ? 'preference' : candidate.category,
          value: candidate.statement,
          normalizedValue: candidate.statement.toLocaleLowerCase(),
          statement: candidate.statement,
          authority: 'user_observed',
          confidence: candidate.confidence === 'high' ? 0.9 : 0.7,
          inferredImportance: 0.65,
          consequence: 'medium',
          actionability: 0.6,
          volatility: candidate.category === 'routine' || candidate.category === 'communication' ? 'slow' : 'stable',
          sensitivity: policy.sensitivity,
          domain: policy.domain,
          layer: 'pattern',
          sensitivityCategories: policy.sensitivityCategories,
          purposeIds: ['personalization', 'work_assistance'],
          allowedUses: ['answer', 'rank', 'recommend'],
          allowedAgentIds: consentReceipt.allowedAgentIds,
          consentReceiptId: consentReceipt.id,
          disclosurePolicy: 'referenceable',
          observedAt: evidenceItem.occurredAt ?? evidenceItem.modifiedAt ?? Date.now(),
          createdBy: 'connector',
          evidenceId: evidence.id,
          evidenceConfidence: 0.9,
        });
        assertionId = result.assertion?.id ?? assertionId;
        candidateCreated ||= result.action === 'created' || result.action === 'superseded';
        if (index === 0 && result.action === 'created') created += 1;
      }
      outputs.push({
        candidateKey,
        ...(assertionId ? { objectType: 'assertion', objectId: assertionId } : {}),
        outcome: assertionId ? (candidateCreated ? 'created' : 'deduplicated') : 'rejected',
      });
    }
    let knowledgeCount = 0;
    for (const thread of analysis.workThreadCandidates) {
      const evidenceRefs = [...new Set(thread.evidenceRefs)].filter((ref) => byRef.has(ref));
      const candidateKey = evidenceKey(input.sourceInstanceId, evidenceRefs);
      if (!evidenceRefs.length) {
        outputs.push({ candidateKey, outcome: 'rejected' });
        continue;
      }
      const goalEvidence = evidenceRefs.flatMap((ref) => {
        const item = byRef.get(ref);
        return item?.ownerAttribution === 'user' ? [item] : [];
      });
      if (consentReceipt?.allowedDomains.includes('goals')
        && !consentReceipt.deniedDomains.includes('goals')
        && thread.confidence !== 'low' && goalEvidence.length) {
        const observedAt = Math.max(...goalEvidence.map((item) => item.occurredAt ?? item.modifiedAt ?? Date.now()));
        const validityDays = thread.horizon === 'current' ? 30 : thread.horizon === 'ongoing' ? 90 : 365;
        let goalCreated = false;
        for (const evidenceItem of goalEvidence) {
          const evidence = createContextEvidence({
            sourceType: 'connector', sourceInstanceId: input.sourceInstanceId,
            sourceRef: evidenceItem.evidenceRef, redactedExcerpt: evidenceItem.title.slice(0, 600),
            trustLevel: 'owner', observedAt: evidenceItem.occurredAt ?? evidenceItem.modifiedAt ?? observedAt,
          });
          const result = reconcileAssertion({
            subject: { type: 'goal', id: thread.topicKey },
            predicate: 'goal.connected.current_state', cardinality: 'single', scope: { type: 'global' },
            kind: 'current_state', value: { title: thread.title, summary: thread.summary, status: thread.status },
            normalizedValue: `${thread.status}:${thread.title}:${thread.summary}`.toLocaleLowerCase(),
            statement: `${thread.title}: ${thread.summary}`,
            authority: 'user_observed', confidence: thread.confidence === 'high' ? 0.9 : 0.72,
            inferredImportance: thread.horizon === 'current' ? 0.8 : 0.65,
            consequence: 'medium', actionability: 0.85, volatility: 'event', sensitivity: 'normal',
            domain: 'goals', layer: 'fact', sensitivityCategories: [],
            purposeIds: ['personalization', 'work_assistance'],
            allowedUses: ['answer', 'rank', 'recommend', 'remind'],
            allowedAgentIds: consentReceipt.allowedAgentIds, consentReceiptId: consentReceipt.id,
            disclosurePolicy: 'referenceable', observedAt, validFrom: observedAt,
            validTo: observedAt + validityDays * 86_400_000,
            reviewAt: observedAt + Math.min(validityDays, 14) * 86_400_000,
            createdBy: 'connector', evidenceId: evidence.id,
            evidenceConfidence: thread.confidence === 'high' ? 0.9 : 0.72,
          });
          goalCreated ||= result.action === 'created' || result.action === 'superseded';
        }
        if (goalCreated) created += 1;
      }
      const result = writeKnowledgeItem({
        kind: 'work_thread',
        scope: { type: 'global' },
        content: `${thread.title}: ${thread.summary}`,
        canonicalKey: candidateKey,
        confidence: thread.confidence === 'high' ? 0.9 : thread.confidence === 'medium' ? 0.72 : 0.55,
        importance: thread.horizon === 'current' ? 0.75 : 0.5,
        originClass: 'untrusted',
        sourceAgentId: input.agentId,
        source: { sourceRunId: input.sourceRunId, evidenceRefs },
        replaceExisting: true,
      });
      if (result.created) knowledgeCount += 1;
      outputs.push({
        candidateKey,
        ...(result.item ? { objectType: 'knowledge', objectId: result.item.id } : {}),
        outcome: result.created ? 'created' : result.item ? 'deduplicated' : 'rejected',
      });
    }
    finishContextExtractionRun({ runId: extraction.run.id, status: 'completed', outputs });
    const sourceStatus = analysis.sourceStatuses.find((item) => item.sourceId === 'connected-work');
    log.info({
      sourceRunId: input.sourceRunId,
      sourceInstanceId: input.sourceInstanceId,
      sourceItemCount: sourceItems.length,
      assertionCreated: created,
      knowledgeCreated: knowledgeCount,
      deduplicated: outputs.filter((output) => output.outcome === 'deduplicated').length,
      rejected: outputs.filter((output) => output.outcome === 'rejected').length,
      sourceStatus: sourceStatus?.status ?? 'failed',
    }, 'Connected source semantic analysis finished');
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
