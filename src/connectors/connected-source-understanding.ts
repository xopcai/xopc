import { createHash } from 'node:crypto';

import { consentFilteredText } from '../user-context/sources/consent-fields.js';
import type { Config } from '../config/schema.js';
import { writeKnowledgeItem } from '../knowledge-memory/index.js';
import type { KnowledgeSourceItem } from '../knowledge/types.js';
import {
  finishContextExtractionRun,
  getKnowledgeSourceItem,
  listKnowledgeSourceItems,
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
import type {
  CalibrationQuestion,
  WorkDiscoveryProfileCandidate,
  WritingStyleCandidate,
} from '../work-discovery/types.js';
import { createLogger } from '../utils/logger.js';
import { recordConnectedSourceObservations } from './connected-source-observations.js';
import { buildConnectorSignalSummary } from './signal-summary.js';

const MAX_CONNECTED_ITEMS = 300;
const MAX_SUMMARY_SCAN_ITEMS = 500;
const log = createLogger('ConnectedSourceUnderstanding');
const PII_PATTERN = /\b(?:\d{3}-\d{2}-\d{4}|(?:\+?\d[\d\s\-()]{8,}\d)|(?:sk-|ghp_|gho_|xox[baprs]-|AIza)[A-Za-z0-9_-]{10,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i;
const PRIVATE_RELATIONSHIP_RE = /\b(wife|husband|spouse|girlfriend|boyfriend|partner|lover|divorce|dating|therapist|psychiatrist|family member|mother|father|son|daughter)\b|妻子|丈夫|配偶|女友|男友|伴侣|离婚|恋爱|心理医生|母亲|父亲|儿子|女儿/i;

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

function itemPriority(item: KnowledgeSourceItem): number {
  if (item.itemType === 'connected_content') return 4;
  if (item.metadata.actorAttributed === true && item.metadata.automated !== true) return 3;
  if (item.metadata.automated !== true) return 2;
  return 1;
}

export function connectedItemsForUnderstanding(items: KnowledgeSourceItem[]): UnderstandingSourceItem[] {
  return [...items]
    .filter((item) => item.metadata.declined !== true)
    .sort((left, right) => {
      const priorityDiff = itemPriority(right) - itemPriority(left);
      if (priorityDiff !== 0) return priorityDiff;
      const rightTs = timestamp(right.occurredAt) ?? timestamp(right.sourceUpdatedAt) ?? 0;
      const leftTs = timestamp(left.occurredAt) ?? timestamp(left.sourceUpdatedAt) ?? 0;
      return rightTs - leftTs;
    })
    .slice(0, MAX_CONNECTED_ITEMS).flatMap((item) => {
    const value = normalizedValue(item);
    const toolkit = text(item.metadata.toolkit)?.toLowerCase();
    const title = text(value.title) ?? text(value.subject) ?? text(value.fullName)
      ?? text(value.repository) ?? `${text(item.metadata.toolkit) ?? 'Connected source'} ${item.itemType}`;
    const normalizedText = item.normalizedText?.trim();
    if (!title && !normalizedText) return [];
    return [{
      id: item.id,
      sourceId: toolkit ? `connector:${toolkit}` : 'connected-work',
      type: itemType(item.itemType),
      title,
      ...(normalizedText ? { text: normalizedText.slice(0, 24_000) } : {}),
      ...(toolkit ? { group: toolkit } : {}),
      ...(timestamp(item.occurredAt) ? { occurredAt: timestamp(item.occurredAt) } : {}),
      ...(timestamp(item.sourceUpdatedAt) ? { modifiedAt: timestamp(item.sourceUpdatedAt) } : {}),
      ownerAttribution: item.metadata.actorAttributed === true ? 'user' : 'shared',
      sensitivity: item.sensitivity,
      evidenceRef: `knowledge-source://${item.id}`,
    } satisfies UnderstandingSourceItem];
    });
}

type PortraitCandidate = WorkDiscoveryProfileCandidate & {
  category: 'role' | 'responsibility' | 'capability' | 'preference' | 'routine' | 'communication' | 'relationship';
};

function isPortraitCandidate(candidate: WorkDiscoveryProfileCandidate): candidate is PortraitCandidate {
  return candidate.category === 'role'
    || candidate.category === 'responsibility'
    || candidate.category === 'capability'
    || candidate.category === 'preference'
    || candidate.category === 'routine'
    || candidate.category === 'communication'
    || candidate.category === 'relationship';
}

export function resolveUnderstandingLocale(config: Config): string | undefined {
  const responseLanguage = config.userContext.preferences.responseLanguage;
  return responseLanguage === 'zh-CN' || responseLanguage === 'en' ? responseLanguage : undefined;
}

export function containsSensitivePii(value: string): boolean {
  return PII_PATTERN.test(value);
}

function expandEvidenceRefs(
  refs: readonly string[] | undefined,
  byRef: ReadonlyMap<string, UnderstandingSourceItem>,
  summaryRefExpansions?: ReadonlyMap<string, UnderstandingSourceItem[]>,
): UnderstandingSourceItem[] {
  const deduped = new Map<string, UnderstandingSourceItem>();
  for (const ref of refs ?? []) {
    const expanded = summaryRefExpansions?.get(ref);
    if (expanded?.length) {
      for (const item of expanded) deduped.set(item.evidenceRef, item);
      continue;
    }
    const direct = byRef.get(ref);
    if (direct && !direct.group?.endsWith(':signal-summary')) {
      deduped.set(direct.evidenceRef, direct);
    }
  }
  return [...deduped.values()];
}

function durableEvidence(
  candidate: PortraitCandidate,
  items: Map<string, UnderstandingSourceItem>,
  summaryRefExpansions?: ReadonlyMap<string, UnderstandingSourceItem[]>,
) {
  const evidence = expandEvidenceRefs(candidate.evidenceRefs, items, summaryRefExpansions);
  const required = candidate.category === 'routine' ? 3 : 2;
  const dates = new Set(evidence.map((item) => item.occurredAt ?? item.modifiedAt)
    .filter((value): value is number => value !== undefined)
    .map((value) => new Date(value).toISOString().slice(0, 10)));
  return candidate.confidence === 'high' && evidence.every((item) => item.ownerAttribution === 'user')
    && evidence.length >= required && dates.size >= required ? evidence : [];
}

function candidatePolicy(candidate: PortraitCandidate): {
  domain: 'identity' | 'goals' | 'capabilities' | 'preferences' | 'behavior' | 'relationships';
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
          : candidate.category === 'routine' ? 'behavior'
            : candidate.category === 'relationship' ? 'relationships' : 'preferences',
    sensitivity: sensitivityCategories.length
      ? sensitivityCategories.includes('health') || sensitivityCategories.includes('financial') ? 'regulated' : 'personal'
      : 'normal',
    sensitivityCategories,
  };
}

export function persistConnectedWritingPreference(input: {
  pref: WritingStyleCandidate;
  evidenceItems: UnderstandingSourceItem[];
  sourceItemsByRef: ReadonlyMap<string, KnowledgeSourceItem>;
  sourceInstanceId: string;
  consentReceipt: UnderstandingConsentReceipt;
}): { assertionId?: string; created: boolean; updated: boolean } {
  const ownerEvidence = input.evidenceItems.filter((item) => item.ownerAttribution === 'user');
  if (!ownerEvidence.length || containsSensitivePii(input.pref.statement)) {
    return { created: false, updated: false };
  }
  const confidence = input.pref.confidence === 'high' ? 0.9 : input.pref.confidence === 'medium' ? 0.75 : 0.6;
  let assertionId: string | undefined;
  let created = false;
  let updated = false;
  for (const [index, evidenceItem] of ownerEvidence.slice(0, 6).entries()) {
    const sourceItem = input.sourceItemsByRef.get(evidenceItem.evidenceRef);
    const evidence = createContextEvidence({
      sourceType: 'connector',
      sourceInstanceId: sourceItem?.sourceInstanceId ?? input.sourceInstanceId,
      sourceItemId: sourceItem?.id,
      contentHash: sourceItem?.contentHash,
      sourceRef: evidenceItem.evidenceRef,
      redactedExcerpt: evidenceItem.title.slice(0, 600),
      trustLevel: 'owner',
      observedAt: evidenceItem.occurredAt ?? evidenceItem.modifiedAt ?? Date.now(),
    });
    const result = reconcileAssertion({
      subject: { type: 'user', id: 'self' },
      predicate: `preference.writing.${input.pref.dimension}`,
      cardinality: 'single',
      scope: { type: 'global' },
      kind: 'preference',
      value: input.pref.statement,
      normalizedValue: input.pref.statement.toLocaleLowerCase(),
      statement: input.pref.statement,
      authority: 'user_observed',
      confidence,
      inferredImportance: 0.75,
      consequence: 'low',
      actionability: 0.8,
      volatility: 'slow',
      sensitivity: 'normal',
      domain: 'preferences',
      layer: 'pattern',
      sensitivityCategories: [],
      purposeIds: ['personalization', 'work_assistance'],
      allowedUses: ['answer', 'rank', 'recommend'],
      allowedAgentIds: input.consentReceipt.allowedAgentIds,
      consentReceiptId: input.consentReceipt.id,
      disclosurePolicy: 'referenceable',
      applicability: { operation: ['response'] },
      observedAt: evidenceItem.occurredAt ?? evidenceItem.modifiedAt ?? Date.now(),
      createdBy: 'connector',
      evidenceId: evidence.id,
      evidenceConfidence: confidence,
    });
    assertionId = result.assertion?.id ?? assertionId;
    updated ||= result.action === 'created' || result.action === 'superseded';
    if (index === 0 && result.action === 'created') created = true;
  }
  return { assertionId, created, updated };
}

export async function deriveConnectedSourceUnderstanding(input: {
  config: Config;
  agentId: string;
  sourceInstanceId: string;
  sourceItemIds: string[];
  sourceRunId: string;
  processingPolicy: 'local_only' | 'remote_allowed';
  analyze?: typeof analyzeUnderstandingSources;
  batchOrdinal?: number;
  assertAuthorized?: () => void;
}): Promise<{
  created: number;
  knowledgeCount: number;
  status: 'completed' | 'partial' | 'failed';
  error?: string;
  calibrationQuestions?: CalibrationQuestion[];
}> {
  const uniqueIds = [...new Set(input.sourceItemIds)];
  if (uniqueIds.length > MAX_CONNECTED_ITEMS) {
    let created = 0, knowledgeCount = 0;
    let status: 'completed' | 'partial' | 'failed' = 'completed';
    for (let offset = 0; offset < uniqueIds.length; offset += MAX_CONNECTED_ITEMS) {
      const batch = await deriveConnectedSourceUnderstanding({ ...input,
        sourceItemIds: uniqueIds.slice(offset, offset + MAX_CONNECTED_ITEMS), batchOrdinal: offset / MAX_CONNECTED_ITEMS });
      created += batch.created; knowledgeCount += batch.knowledgeCount;
      if (batch.status !== 'completed') status = 'partial';
    }
    return { created, knowledgeCount, status };
  }
  const sourceItems = uniqueIds
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
  const allowPersonal = input.config.userContext.enabled && input.config.userContext.userModel.enabled
    && input.config.userContext.userModel.writePolicy === 'allow' && consentReceipt?.purposes.includes('personalization');
  const allowWork = input.config.userContext.enabled && input.config.userContext.knowledgeMemory.enabled
    && input.config.userContext.knowledgeMemory.writePolicy === 'allow' && consentReceipt?.purposes.includes('work_assistance');
  if (!allowPersonal && !allowWork) return { created: 0, knowledgeCount: 0, status: 'completed' };
  const baseModelItems = itemsAllowedByConsent(items, consentReceipt);
  const primaryToolkit = text(sourceItems[0]?.metadata.toolkit)?.toLowerCase() ?? '';
  const retainedItems = input.batchOrdinal === undefined || input.batchOrdinal === 0
    ? listKnowledgeSourceItems({
      sourceInstanceId: input.sourceInstanceId,
      agentId: input.agentId,
      includeDeleted: false,
      limit: MAX_SUMMARY_SCAN_ITEMS,
    })
    : [];
  const summarySourcePool = retainedItems.length >= sourceItems.length ? retainedItems : sourceItems;
  const summaryResult = summarySourcePool.length >= 2 && primaryToolkit
    ? buildConnectorSignalSummary({
      toolkit: primaryToolkit,
      items: summarySourcePool,
      consent: consentReceipt,
    })
    : undefined;
  const retainedByRef = new Map<string, KnowledgeSourceItem>(
    summarySourcePool.map((item) => [`knowledge-source://${item.id}`, item]),
  );
  for (const item of sourceItems) retainedByRef.set(`knowledge-source://${item.id}`, item);
  const retainedModelItems = itemsAllowedByConsent(connectedItemsForUnderstanding(summarySourcePool), consentReceipt);
  const byRef = new Map<string, UnderstandingSourceItem>(
    retainedModelItems.map((item) => [item.evidenceRef, item]),
  );
  for (const item of baseModelItems) byRef.set(item.evidenceRef, item);
  const summaryRefExpansions = new Map<string, UnderstandingSourceItem[]>();
  const modelItems = [...baseModelItems];
  if (summaryResult?.summaryItem) {
    const backingRefs = summaryResult.ownerBackedEvidenceRefs.length
      ? summaryResult.ownerBackedEvidenceRefs
      : summaryResult.backingEvidenceRefs;
    const expanded = backingRefs.flatMap((ref) => {
      const resolved = byRef.get(ref);
      return resolved ? [resolved] : [];
    });
    if (expanded.length) {
      summaryRefExpansions.set(summaryResult.summaryItem.evidenceRef, expanded);
      byRef.set(summaryResult.summaryItem.evidenceRef, summaryResult.summaryItem);
      modelItems.push(summaryResult.summaryItem);
    }
  }
  if (allowPersonal) recordConnectedSourceObservations({
    items: sourceItems, consent: consentReceipt, sourceGrantId: sourceRun?.grantId,
  });
  const effectiveProcessingPolicy = input.processingPolicy === 'remote_allowed'
    && consentReceipt?.processingPolicy === 'remote_allowed'
    ? 'remote_allowed' as const
    : 'local_only' as const;
  const extraction = claimRegisteredExtraction({
    extractorId: 'connector-semantic',
    sourceRef: `understanding-source-run:${input.sourceRunId}${input.batchOrdinal === undefined ? '' : `:batch:${input.batchOrdinal}`}`,
    contentForHash: sourceItems.map((item) => `${item.id}:${item.contentHash}`).join('\n'),
    processingPolicy: effectiveProcessingPolicy,
    destination: 'remote_model',
  });
  if (!allowsRemoteSourceProcessing([effectiveProcessingPolicy]) || !extraction.shouldExecute) {
    return { created: 0, knowledgeCount: 0, status: 'completed' };
  }
  try {
    const locale = resolveUnderstandingLocale(input.config);
    const analysis = await (input.analyze ?? analyzeUnderstandingSources)({
      config: input.config,
      items: modelItems,
      ...(locale ? { locale } : {}),
    });
    input.assertAuthorized?.();
    const outputs: ExtractionOutput[] = [];
    let created = 0;
    for (const candidate of (allowPersonal ? analysis.profileCandidates.filter(isPortraitCandidate) : [])) {
      const policy = candidatePolicy(candidate);
      const evidenceItems = durableEvidence(candidate, byRef, summaryRefExpansions);
      const candidateKey = `connected-profile:${candidate.category}:${candidate.factKey}`;
      const blockedRelationship = candidate.category === 'relationship' && PRIVATE_RELATIONSHIP_RE.test(candidate.statement);
      if (!evidenceItems.length || !consentReceipt
        || containsSensitivePii(candidate.statement)
        || blockedRelationship
        || !consentReceipt.allowedDomains.includes(policy.domain)
        || consentReceipt.deniedDomains.includes(policy.domain)) {
        outputs.push({ candidateKey, outcome: 'rejected' });
        continue;
      }
      let assertionId: string | undefined;
      let candidateCreated = false;
      for (const [index, evidenceItem] of evidenceItems.entries()) {
        const sourceItem = retainedByRef.get(evidenceItem.evidenceRef);
        const evidence = createContextEvidence({
          sourceType: 'connector',
          sourceInstanceId: input.sourceInstanceId,
          sourceItemId: sourceItem?.id, contentHash: sourceItem?.contentHash,
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
    if (allowPersonal && consentReceipt
      && consentReceipt.allowedDomains.includes('preferences')
      && !consentReceipt.deniedDomains.includes('preferences')) {
      for (const pref of analysis.writingPreferences ?? []) {
        const candidateKey = `connected-writing:${pref.dimension}:${pref.factKey}`;
        const evidenceItems = expandEvidenceRefs(pref.evidenceRefs, byRef, summaryRefExpansions);
        const persisted = persistConnectedWritingPreference({
          pref,
          evidenceItems,
          sourceItemsByRef: retainedByRef,
          sourceInstanceId: input.sourceInstanceId,
          consentReceipt,
        });
        if (persisted.created) created += 1;
        outputs.push({
          candidateKey,
          ...(persisted.assertionId ? { objectType: 'assertion', objectId: persisted.assertionId } : {}),
          outcome: persisted.assertionId ? (persisted.updated ? 'created' : 'deduplicated') : 'rejected',
        });
      }
    }
    let knowledgeCount = 0;
    for (const thread of analysis.workThreadCandidates) {
      const expandedEvidence = expandEvidenceRefs(thread.evidenceRefs, byRef, summaryRefExpansions);
      const evidenceRefs = expandedEvidence.map((item) => item.evidenceRef);
      const candidateKey = evidenceKey(input.sourceInstanceId, evidenceRefs);
      if (!evidenceRefs.length) {
        outputs.push({ candidateKey, outcome: 'rejected' });
        continue;
      }
      const goalEvidence = expandedEvidence.filter((item) => item.ownerAttribution === 'user');
      if (allowPersonal && consentReceipt?.allowedDomains.includes('goals')
        && !consentReceipt.deniedDomains.includes('goals')
        && thread.confidence !== 'low' && goalEvidence.length) {
        const observedAt = Math.max(...goalEvidence.map((item) => item.occurredAt ?? item.modifiedAt ?? Date.now()));
        const validityDays = thread.horizon === 'current' ? 30 : thread.horizon === 'ongoing' ? 90 : 365;
        let goalCreated = false;
        for (const evidenceItem of goalEvidence) {
          const sourceItem = retainedByRef.get(evidenceItem.evidenceRef);
          const evidence = createContextEvidence({
            sourceType: 'connector', sourceInstanceId: input.sourceInstanceId,
            sourceItemId: sourceItem?.id, contentHash: sourceItem?.contentHash,
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
      if (!allowWork) continue;
      const evidence = expandedEvidence.flatMap((evidenceItem) => {
        const sourceItem = retainedByRef.get(evidenceItem.evidenceRef);
        if (!sourceItem || !consentReceipt) return [];
        const record = createContextEvidence({
          sourceType: 'connector', sourceInstanceId: input.sourceInstanceId,
          sourceRef: evidenceItem.evidenceRef, sourceItemId: sourceItem.id, sourceRunId: input.sourceRunId,
          contentHash: sourceItem.contentHash, processingPolicy: effectiveProcessingPolicy,
          redactedExcerpt: evidenceItem.title.slice(0, 600), trustLevel: 'untrusted',
          observedAt: evidenceItem.occurredAt ?? evidenceItem.modifiedAt ?? Date.now(),
        });
        return [{ id: record.id, contentHash: sourceItem.contentHash, consentReceiptId: consentReceipt.id }];
      });
      const result = writeKnowledgeItem({
        kind: 'work_thread',
        claimMode: 'reported', verification: evidence.length === evidenceRefs.length ? 'supported' : 'tentative',
        evidence,
        reviewAt: Date.now() + (thread.horizon === 'current' ? 14 : 90) * 86_400_000,
        scope: { type: 'global' },
        content: `${thread.title}: ${thread.summary}`,
        canonicalKey: candidateKey,
        confidence: thread.confidence === 'high' ? 0.9 : thread.confidence === 'medium' ? 0.72 : 0.55,
        importance: thread.horizon === 'current' ? 0.75 : 0.5,
        originClass: 'untrusted',
        sourceAgentId: input.agentId,
        source: { sourceRunId: input.sourceRunId, sourceInstanceId: input.sourceInstanceId, consentReceiptId: consentReceipt?.id, evidenceRefs },
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
    const expectedSourceId = primaryToolkit ? `connector:${primaryToolkit}` : 'connected-work';
    const sourceStatus = analysis.sourceStatuses.find((item) => item.sourceId === expectedSourceId)
      ?? analysis.sourceStatuses.find((item) => item.sourceId === 'connected-work')
      ?? (analysis.sourceStatuses.length === 1 ? analysis.sourceStatuses[0] : undefined);
    const calibrationQuestions = analysis.calibrationQuestions?.length ? analysis.calibrationQuestions : undefined;
    log.info({
      sourceRunId: input.sourceRunId,
      sourceInstanceId: input.sourceInstanceId,
      sourceItemCount: sourceItems.length,
      summaryIncluded: Boolean(summaryResult?.summaryItem),
      assertionCreated: created,
      knowledgeCreated: knowledgeCount,
      writingCount: analysis.writingPreferences?.length ?? 0,
      deduplicated: outputs.filter((output) => output.outcome === 'deduplicated').length,
      rejected: outputs.filter((output) => output.outcome === 'rejected').length,
      sourceStatus: sourceStatus?.status ?? 'failed',
    }, 'Connected source semantic analysis finished');
    return {
      created,
      knowledgeCount,
      status: sourceStatus?.status ?? 'failed',
      ...(sourceStatus?.error ? { error: sourceStatus.error } : {}),
      ...(calibrationQuestions ? { calibrationQuestions } : {}),
    };
  } catch (error) {
    finishContextExtractionRun({ runId: extraction.run.id, status: 'failed', errorCode: 'extractor_failed' });
    throw error;
  }
}
