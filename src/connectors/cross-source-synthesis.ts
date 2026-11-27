import { createHash } from 'node:crypto';

import type { Config } from '../config/schema.js';
import { listKnowledgeItems, writeKnowledgeItem } from '../knowledge-memory/index.js';
import type { KnowledgeSourceItem } from '../knowledge/types.js';
import {
  finishContextExtractionRun,
  listKnowledgeSourceItems,
  type ContextExtractionOutput,
} from '../storage/sqlite/index.js';
import { createContextEvidence } from '../storage/sqlite/context-evidence-repository.js';
import { claimRegisteredExtraction } from '../user-context/extraction/registry.js';
import { getActiveUnderstandingConsent } from '../user-context/sources/consent-repository.js';
import { consentFilteredText } from '../user-context/sources/consent-fields.js';
import { allowsRemoteSourceProcessing } from '../user-context/sources/processing-policy.js';
import { listUnderstandingSourceGrants } from '../user-context/sources/repository.js';
import type { UnderstandingConsentReceipt, UnderstandingSourceItem } from '../user-context/sources/types.js';
import {
  listUserAssertions,
  listUserAssertionSources,
  listUserModelObservations,
  reconcileAssertion,
} from '../user-model/index.js';
import { createLogger } from '../utils/logger.js';
import { analyzeUnderstandingSources } from '../work-discovery/analyzer.js';
import type { CalibrationQuestion, WorkDiscoveryProfileCandidate } from '../work-discovery/types.js';
import {
  connectedItemsForUnderstanding,
  containsSensitivePii,
  persistConnectedWritingPreference,
  resolveUnderstandingLocale,
} from './connected-source-understanding.js';
import { buildConnectorSignalSummary } from './signal-summary.js';

const MAX_SCAN_PER_CONNECTOR = 500;
const MAX_SAMPLE_ITEMS_PER_CONNECTOR = 12;
const log = createLogger('CrossSourceSynthesis');

const PRIVATE_RELATIONSHIP_RE = /\b(wife|husband|spouse|girlfriend|boyfriend|partner|lover|divorce|dating|therapist|psychiatrist|family member|mother|father|son|daughter)\b|妻子|丈夫|配偶|女友|男友|伴侣|离婚|恋爱|心理医生|母亲|父亲|儿子|女儿/i;

type ExtractionOutput = Omit<ContextExtractionOutput, 'id' | 'runId' | 'ordinal' | 'createdAt'>;
type PortraitCategory = 'role' | 'responsibility' | 'capability' | 'preference' | 'routine' | 'communication' | 'relationship';
type PortraitCandidate = WorkDiscoveryProfileCandidate & { category: PortraitCategory };

function isPortraitCandidate(candidate: WorkDiscoveryProfileCandidate): candidate is PortraitCandidate {
  return candidate.category === 'role'
    || candidate.category === 'responsibility'
    || candidate.category === 'capability'
    || candidate.category === 'preference'
    || candidate.category === 'routine'
    || candidate.category === 'communication'
    || candidate.category === 'relationship';
}

function toolkitFromAdapterId(adapterId: string): string {
  const raw = adapterId.startsWith('connector:') ? adapterId.slice('connector:'.length) : adapterId;
  return raw.startsWith('composio-') ? raw.slice('composio-'.length) : raw;
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

function filterItemByConsent(item: UnderstandingSourceItem, consent: UnderstandingConsentReceipt): UnderstandingSourceItem {
  const allowed = new Set(consent.allowedFields);
  const filteredText = consentFilteredText(item.text, allowed);
  return {
    id: item.id,
    sourceId: item.sourceId,
    type: item.type,
    title: allowed.has('title') ? item.title : item.type,
    ...(filteredText ? { text: filteredText } : {}),
    ...(allowed.has('owner_activity') ? { ownerAttribution: item.ownerAttribution } : { ownerAttribution: 'unknown' }),
    ...(allowed.has('timestamps') && item.occurredAt !== undefined ? { occurredAt: item.occurredAt } : {}),
    ...(allowed.has('timestamps') && item.modifiedAt !== undefined ? { modifiedAt: item.modifiedAt } : {}),
    evidenceRef: item.evidenceRef,
    sensitivity: item.sensitivity,
    ...(item.group ? { group: item.group } : {}),
  };
}

function buildObservationSummaryItem(
  allowedGrantIds: ReadonlySet<string>,
  nowMs: number,
): { item?: UnderstandingSourceItem; backingSourceIds: string[] } {
  const observations = listUserModelObservations({ limit: 500 }).filter((obs) => (
    obs.ownerAttribution === 'user'
    && (!obs.sourceGrantId || allowedGrantIds.has(obs.sourceGrantId))
    && nowMs - obs.observedAt <= 90 * 86_400_000
  ));
  if (observations.length < 3) return { backingSourceIds: [] };
  const byType = new Map<string, { domain: string; count: number; dates: Set<string>; toolkits: Set<string> }>();
  const distinctDates = new Set<string>();
  const toolkits = new Set<string>();
  for (const obs of observations) {
    const dateKey = new Date(obs.observedAt).toISOString().slice(0, 10);
    distinctDates.add(dateKey);
    const toolkit = typeof obs.context.toolkit === 'string' ? obs.context.toolkit : 'activity';
    toolkits.add(toolkit);
    const key = `${obs.domain}:${obs.type}`;
    const entry = byType.get(key) ?? { domain: obs.domain, count: 0, dates: new Set<string>(), toolkits: new Set<string>() };
    entry.count += 1;
    entry.dates.add(dateKey);
    entry.toolkits.add(toolkit);
    byType.set(key, entry);
  }
  if (distinctDates.size < 2) return { backingSourceIds: [] };
  const summary = {
    signalSummary: 'observations',
    totalOwnerObservations: observations.length,
    distinctActiveDates: distinctDates.size,
    patterns: [...byType.entries()].map(([key, value]) => ({
      activity: key,
      domain: value.domain,
      count: value.count,
      distinctDates: value.dates.size,
      sources: [...value.toolkits],
    })),
  };
  return {
    backingSourceIds: [...toolkits].map((tk) => `connector:${tk}`),
    item: {
      id: 'signal-summary:observations',
      sourceId: 'connector:observations',
      type: 'note',
      title: 'Aggregated multi-week user activity observations',
      text: JSON.stringify(summary),
      group: 'observations:signal-summary',
      occurredAt: nowMs,
      modifiedAt: nowMs,
      ownerAttribution: 'user',
      sensitivity: 'personal',
      evidenceRef: 'signal-summary://observations',
    },
  };
}

export interface CrossSourceSynthesisResult {
  skipped: boolean;
  sourcesAnalyzed: string[];
  assertionsCreated: number;
  knowledgeUpdated: number;
  writingPreferencesPersisted: number;
  calibrationQuestions: CalibrationQuestion[];
}

/** Synthesizes corroborated user understanding across all active authorized connectors and retained work context. */
export async function synthesizeConnectedSources(input: {
  config: Config;
  agentId: string;
  trigger?: 'bootstrap' | 'refresh' | 'maintenance' | 'manual';
  force?: boolean;
  nowMs?: number;
  analyze?: typeof analyzeUnderstandingSources;
}): Promise<CrossSourceSynthesisResult> {
  const nowMs = input.nowMs ?? Date.now();
  const empty: CrossSourceSynthesisResult = {
    skipped: true,
    sourcesAnalyzed: [],
    assertionsCreated: 0,
    knowledgeUpdated: 0,
    writingPreferencesPersisted: 0,
    calibrationQuestions: [],
  };
  if (!input.config.userContext.enabled) return empty;
  const allowPersonalConfig = input.config.userContext.userModel.enabled
    && input.config.userContext.userModel.writePolicy === 'allow';
  const allowWorkConfig = input.config.userContext.knowledgeMemory.enabled
    && input.config.userContext.knowledgeMemory.writePolicy === 'allow';
  if (!allowPersonalConfig && !allowWorkConfig) return empty;

  const grants = listUnderstandingSourceGrants().filter((grant) => (
    grant.status === 'active'
    && grant.adapterId.startsWith('connector:')
    && typeof grant.config.sourceInstanceId === 'string'
  ));
  if (!grants.length) return empty;

  type ConnectorBundle = {
    grantId: string;
    sourceInstanceId: string;
    toolkit: string;
    sourceId: string;
    consent: UnderstandingConsentReceipt;
    items: KnowledgeSourceItem[];
  };
  const bundles: ConnectorBundle[] = [];
  for (const grant of grants) {
    const consent = getActiveUnderstandingConsent(grant.id);
    if (!consent || !allowsRemoteSourceProcessing([grant.processingPolicy, consent.processingPolicy])) continue;
    if (consent.allowedAgentIds?.length && !consent.allowedAgentIds.includes(input.agentId)) continue;
    const sourceInstanceId = String(grant.config.sourceInstanceId);
    const items = listKnowledgeSourceItems({
      sourceInstanceId,
      agentId: input.agentId,
      includeDeleted: false,
      limit: MAX_SCAN_PER_CONNECTOR,
    });
    if (!items.length) continue;
    const toolkit = typeof items[0]?.metadata.toolkit === 'string' && items[0].metadata.toolkit.trim()
      ? items[0].metadata.toolkit.trim().toLowerCase()
      : toolkitFromAdapterId(grant.adapterId);
    bundles.push({
      grantId: grant.id,
      sourceInstanceId,
      toolkit,
      sourceId: `connector:${toolkit}`,
      consent,
      items,
    });
  }
  if (!bundles.length) return empty;

  const allowedGrantIds = new Set(bundles.map((bundle) => bundle.grantId));
  const observationSummary = buildObservationSummaryItem(allowedGrantIds, nowMs);
  const existingWorkThreads = listKnowledgeItems({
    statuses: ['active', 'candidate'],
    limit: 100,
  }).filter((item) => item.kind === 'work_thread').slice(0, 25);

  // Require >= 2 active connector bundles unless forced or corroborated with multi-week observations / work threads.
  const distinctSourceCount = bundles.length + (observationSummary.item ? 1 : 0);
  if (!input.force && distinctSourceCount < 2) return empty;

  const allSourceItemsByRef = new Map<string, { item: KnowledgeSourceItem; bundle: ConnectorBundle }>();
  const byRef = new Map<string, UnderstandingSourceItem>();
  const summaryRefExpansions = new Map<string, UnderstandingSourceItem[]>();
  const modelItems: UnderstandingSourceItem[] = [];
  const hashParts: string[] = [];

  for (const bundle of bundles) {
    const converted = connectedItemsForUnderstanding(bundle.items);
    const filtered = converted.map((item) => filterItemByConsent(item, bundle.consent));
    for (const raw of bundle.items) {
      allSourceItemsByRef.set(`knowledge-source://${raw.id}`, { item: raw, bundle });
    }
    for (const item of filtered) byRef.set(item.evidenceRef, item);

    const summary = buildConnectorSignalSummary({
      toolkit: bundle.toolkit,
      items: bundle.items,
      consent: bundle.consent,
      nowMs,
    });
    if (summary.summaryItem) {
      const backingRefs = summary.ownerBackedEvidenceRefs.length
        ? summary.ownerBackedEvidenceRefs
        : summary.backingEvidenceRefs;
      const expanded = backingRefs.flatMap((ref) => {
        const resolved = byRef.get(ref);
        return resolved ? [resolved] : [];
      });
      if (expanded.length) {
        summaryRefExpansions.set(summary.summaryItem.evidenceRef, expanded);
        byRef.set(summary.summaryItem.evidenceRef, summary.summaryItem);
        modelItems.push(summary.summaryItem);
      }
    }
    for (const sample of filtered.slice(0, MAX_SAMPLE_ITEMS_PER_CONNECTOR)) {
      modelItems.push(sample);
    }
    hashParts.push(`${bundle.sourceInstanceId}:${bundle.items.length}:${bundle.items[0]?.contentHash ?? ''}`);
  }

  if (observationSummary.item) {
    const ownerPool = [...byRef.values()].filter((item) => item.ownerAttribution === 'user' && !item.group?.endsWith(':signal-summary'));
    if (ownerPool.length) {
      summaryRefExpansions.set(observationSummary.item.evidenceRef, ownerPool.slice(0, 20));
      byRef.set(observationSummary.item.evidenceRef, observationSummary.item);
      modelItems.push(observationSummary.item);
      hashParts.push(`obs:${observationSummary.item.text?.length ?? 0}`);
    }
  }

  if (!modelItems.length) return empty;

  const contentForHash = [...hashParts].sort().join('\n');
  const sourceRef = `cross-source-synthesis:${input.agentId}:${input.trigger ?? 'manual'}:${new Date(nowMs).toISOString().slice(0, 10)}`;
  const extraction = claimRegisteredExtraction({
    extractorId: 'connector-cross-source',
    sourceRef,
    contentForHash,
    processingPolicy: 'remote_allowed',
    destination: 'remote_model',
  });
  if (!input.force && !extraction.shouldExecute) return empty;

  const activeAssertions = listUserAssertions({ statuses: ['active'], limit: 40 });
  const existingProfileStatements = activeAssertions.map((assertion) => assertion.statement);
  const assertionSourceMap = listUserAssertionSources(activeAssertions.map((assertion) => assertion.id));
  const localProfileLines = activeAssertions
    .filter((assertion) => (assertionSourceMap.get(assertion.id) ?? []).some(
      (source) => source.kind === 'local_source' || source.kind === 'work_folder',
    ))
    .slice(0, 15)
    .map((assertion) => assertion.statement);
  const workContext = existingWorkThreads.length || localProfileLines.length
    ? {
      projectSummary: 'Cross-source context from local files, work folders, and connected services.',
      currentState: [
        ...existingWorkThreads.slice(0, 10).map((item) => item.content),
        ...(localProfileLines.length ? [`Local file & work-folder signals:\n${localProfileLines.join('\n')}`] : []),
      ].join('\n\n'),
      uncertainties: [],
    }
    : undefined;

  try {
    const locale = resolveUnderstandingLocale(input.config);
    const analysis = await (input.analyze ?? analyzeUnderstandingSources)({
      config: input.config,
      items: modelItems,
      ...(workContext ? { workContext } : {}),
      ...(existingProfileStatements.length ? { existingProfileStatements } : {}),
      ...(locale ? { locale } : {}),
    });

    const outputs: ExtractionOutput[] = [];
    let assertionsCreated = 0;
    let writingPreferencesPersisted = 0;
    let knowledgeUpdated = 0;

    const expandRefs = (refs: readonly string[] | undefined): UnderstandingSourceItem[] => {
      const deduped = new Map<string, UnderstandingSourceItem>();
      for (const ref of refs ?? []) {
        const expanded = summaryRefExpansions.get(ref);
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
    };

    const allowedForDomain = (
      evidenceItems: UnderstandingSourceItem[],
      domain: string,
      purpose: 'personalization' | 'work_assistance',
    ): UnderstandingSourceItem[] => evidenceItems.filter((item) => {
      const entry = allSourceItemsByRef.get(item.evidenceRef);
      if (!entry) return false;
      const { consent } = entry.bundle;
      return consent.purposes.includes(purpose)
        && consent.allowedDomains.includes(domain)
        && !consent.deniedDomains.includes(domain);
    });

    if (allowPersonalConfig) {
      for (const candidate of analysis.profileCandidates.filter(isPortraitCandidate)) {
        const policy = candidatePolicy(candidate);
        const candidateKey = `cross-source-profile:${candidate.category}:${candidate.factKey}`;
        const blockedRelationship = candidate.category === 'relationship' && PRIVATE_RELATIONSHIP_RE.test(candidate.statement);
        if (containsSensitivePii(candidate.statement) || blockedRelationship) {
          outputs.push({ candidateKey, outcome: 'rejected' });
          continue;
        }
        const consentedEvidence = allowedForDomain(
          expandRefs(candidate.evidenceRefs),
          policy.domain,
          'personalization',
        ).filter((item) => item.ownerAttribution === 'user');
        const distinctSources = new Set(consentedEvidence.map((item) => item.sourceId));
        const distinctDates = new Set(
          consentedEvidence
            .map((item) => item.occurredAt ?? item.modifiedAt)
            .filter((ts): ts is number => ts !== undefined)
            .map((ts) => new Date(ts).toISOString().slice(0, 10)),
        );
        const requiredDates = candidate.category === 'routine' ? 3 : 2;
        const corroborated = candidate.confidence === 'high'
          && consentedEvidence.length >= 2
          && (distinctSources.size >= 2 || distinctDates.size >= requiredDates);
        if (!corroborated) {
          outputs.push({ candidateKey, outcome: 'rejected' });
          continue;
        }
        let assertionId: string | undefined;
        let candidateCreated = false;
        for (const [index, evidenceItem] of consentedEvidence.slice(0, 8).entries()) {
          const entry = allSourceItemsByRef.get(evidenceItem.evidenceRef);
          if (!entry) continue;
          const evidence = createContextEvidence({
            sourceType: 'connector',
            sourceInstanceId: entry.bundle.sourceInstanceId,
            sourceItemId: entry.item.id,
            contentHash: entry.item.contentHash,
            sourceRef: evidenceItem.evidenceRef,
            redactedExcerpt: evidenceItem.title.slice(0, 600),
            trustLevel: 'owner',
            observedAt: evidenceItem.occurredAt ?? evidenceItem.modifiedAt ?? nowMs,
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
            confidence: 0.9,
            inferredImportance: distinctSources.size >= 2 ? 0.78 : 0.65,
            consequence: 'medium',
            actionability: 0.65,
            volatility: candidate.category === 'routine' || candidate.category === 'communication' ? 'slow' : 'stable',
            sensitivity: policy.sensitivity,
            domain: policy.domain,
            layer: 'pattern',
            sensitivityCategories: policy.sensitivityCategories,
            purposeIds: ['personalization', 'work_assistance'],
            allowedUses: ['answer', 'rank', 'recommend'],
            allowedAgentIds: entry.bundle.consent.allowedAgentIds,
            consentReceiptId: entry.bundle.consent.id,
            disclosurePolicy: 'referenceable',
            observedAt: evidenceItem.occurredAt ?? evidenceItem.modifiedAt ?? nowMs,
            createdBy: 'connector',
            evidenceId: evidence.id,
            evidenceConfidence: 0.9,
          });
          assertionId = result.assertion?.id ?? assertionId;
          candidateCreated ||= result.action === 'created' || result.action === 'superseded';
          if (index === 0 && result.action === 'created') assertionsCreated += 1;
        }
        outputs.push({
          candidateKey,
          ...(assertionId ? { objectType: 'assertion', objectId: assertionId } : {}),
          outcome: assertionId ? (candidateCreated ? 'created' : 'deduplicated') : 'rejected',
        });
      }

      const rawItemsByRef = new Map<string, KnowledgeSourceItem>(
        [...allSourceItemsByRef.entries()].map(([ref, entry]) => [ref, entry.item]),
      );
      for (const pref of analysis.writingPreferences ?? []) {
        const candidateKey = `cross-source-writing:${pref.dimension}:${pref.factKey}`;
        const evidenceItems = allowedForDomain(expandRefs(pref.evidenceRefs), 'preferences', 'personalization');
        const primary = evidenceItems.length ? allSourceItemsByRef.get(evidenceItems[0]!.evidenceRef) : undefined;
        if (!primary) {
          outputs.push({ candidateKey, outcome: 'rejected' });
          continue;
        }
        const persisted = persistConnectedWritingPreference({
          pref,
          evidenceItems,
          sourceItemsByRef: rawItemsByRef,
          sourceInstanceId: primary.bundle.sourceInstanceId,
          consentReceipt: primary.bundle.consent,
        });
        if (persisted.created) assertionsCreated += 1;
        if (persisted.assertionId) writingPreferencesPersisted += 1;
        outputs.push({
          candidateKey,
          ...(persisted.assertionId ? { objectType: 'assertion', objectId: persisted.assertionId } : {}),
          outcome: persisted.assertionId ? (persisted.updated ? 'created' : 'deduplicated') : 'rejected',
        });
      }
    }

    for (const thread of analysis.workThreadCandidates) {
      const expanded = expandRefs(thread.evidenceRefs);
      if (!expanded.length || containsSensitivePii(thread.title) || containsSensitivePii(thread.summary)) continue;
      const distinctSources = new Set(expanded.map((item) => item.sourceId));
      const canonicalFingerprint = createHash('sha256')
        .update(`cross-source-thread:${thread.topicKey}`)
        .digest('hex')
        .slice(0, 24);
      const candidateKey = `cross-source-thread:${canonicalFingerprint}`;

      const goalEvidence = allowPersonalConfig
        ? allowedForDomain(expanded, 'goals', 'personalization').filter((item) => item.ownerAttribution === 'user')
        : [];
      if (goalEvidence.length && thread.confidence !== 'low') {
        const observedAt = Math.max(...goalEvidence.map((item) => item.occurredAt ?? item.modifiedAt ?? nowMs));
        const validityDays = thread.horizon === 'current' ? 30 : thread.horizon === 'ongoing' ? 90 : 365;
        let goalCreated = false;
        for (const evidenceItem of goalEvidence.slice(0, 6)) {
          const entry = allSourceItemsByRef.get(evidenceItem.evidenceRef);
          if (!entry) continue;
          const evidence = createContextEvidence({
            sourceType: 'connector',
            sourceInstanceId: entry.bundle.sourceInstanceId,
            sourceItemId: entry.item.id,
            contentHash: entry.item.contentHash,
            sourceRef: evidenceItem.evidenceRef,
            redactedExcerpt: evidenceItem.title.slice(0, 600),
            trustLevel: 'owner',
            observedAt: evidenceItem.occurredAt ?? evidenceItem.modifiedAt ?? observedAt,
          });
          const result = reconcileAssertion({
            subject: { type: 'goal', id: thread.topicKey },
            predicate: 'goal.connected.current_state',
            cardinality: 'single',
            scope: { type: 'global' },
            kind: 'current_state',
            value: {
              title: thread.title,
              summary: thread.summary,
              status: thread.status,
              ...(thread.recommendedFirstStep ? { recommendedFirstStep: thread.recommendedFirstStep } : {}),
            },
            normalizedValue: `${thread.status}:${thread.title}:${thread.summary}`.toLocaleLowerCase(),
            statement: `${thread.title}: ${thread.summary}`,
            authority: 'user_observed',
            confidence: distinctSources.size >= 2 || thread.confidence === 'high' ? 0.9 : 0.75,
            inferredImportance: distinctSources.size >= 2 ? 0.88 : thread.horizon === 'current' ? 0.8 : 0.65,
            consequence: 'medium',
            actionability: 0.85,
            volatility: 'event',
            sensitivity: 'normal',
            domain: 'goals',
            layer: 'fact',
            sensitivityCategories: [],
            purposeIds: ['personalization', 'work_assistance'],
            allowedUses: ['answer', 'rank', 'recommend', 'remind'],
            allowedAgentIds: entry.bundle.consent.allowedAgentIds,
            consentReceiptId: entry.bundle.consent.id,
            disclosurePolicy: 'referenceable',
            observedAt,
            validFrom: observedAt,
            validTo: observedAt + validityDays * 86_400_000,
            reviewAt: observedAt + Math.min(validityDays, 14) * 86_400_000,
            createdBy: 'connector',
            evidenceId: evidence.id,
            evidenceConfidence: distinctSources.size >= 2 || thread.confidence === 'high' ? 0.9 : 0.75,
          });
          goalCreated ||= result.action === 'created' || result.action === 'superseded';
        }
        if (goalCreated) assertionsCreated += 1;
      }

      if (!allowWorkConfig) continue;
      const workEvidence = expanded.flatMap((evidenceItem) => {
        const entry = allSourceItemsByRef.get(evidenceItem.evidenceRef);
        if (!entry || !entry.bundle.consent.purposes.includes('work_assistance')) return [];
        const record = createContextEvidence({
          sourceType: 'connector',
          sourceInstanceId: entry.bundle.sourceInstanceId,
          sourceRef: evidenceItem.evidenceRef,
          sourceItemId: entry.item.id,
          contentHash: entry.item.contentHash,
          processingPolicy: 'remote_allowed',
          redactedExcerpt: evidenceItem.title.slice(0, 600),
          trustLevel: 'untrusted',
          observedAt: evidenceItem.occurredAt ?? evidenceItem.modifiedAt ?? nowMs,
        });
        return [{ id: record.id, contentHash: entry.item.contentHash, consentReceiptId: entry.bundle.consent.id }];
      });
      if (!workEvidence.length) continue;
      const result = writeKnowledgeItem({
        kind: 'work_thread',
        claimMode: 'reported',
        verification: workEvidence.length === expanded.length ? 'supported' : 'tentative',
        evidence: workEvidence,
        reviewAt: nowMs + (thread.horizon === 'current' ? 14 : 90) * 86_400_000,
        scope: { type: 'global' },
        content: `${thread.title}: ${thread.summary}`,
        canonicalKey: candidateKey,
        confidence: distinctSources.size >= 2 ? 0.92 : thread.confidence === 'high' ? 0.88 : 0.72,
        importance: distinctSources.size >= 2 ? 0.88 : thread.horizon === 'current' ? 0.75 : 0.55,
        originClass: 'untrusted',
        sourceAgentId: input.agentId,
        source: {
          sourceIds: [...distinctSources],
          evidenceRefs: expanded.map((item) => item.evidenceRef),
        },
        replaceExisting: true,
      });
      if (result.created || result.item) knowledgeUpdated += 1;
      outputs.push({
        candidateKey,
        ...(result.item ? { objectType: 'knowledge', objectId: result.item.id } : {}),
        outcome: result.created ? 'created' : result.item ? 'deduplicated' : 'rejected',
      });
    }

    finishContextExtractionRun({ runId: extraction.run.id, status: 'completed', outputs });
    const calibrationQuestions = analysis.calibrationQuestions ?? [];
    log.info({
      trigger: input.trigger ?? 'manual',
      sources: bundles.map((bundle) => bundle.sourceId),
      assertionsCreated,
      writingPreferencesPersisted,
      knowledgeUpdated,
      calibrationQuestionCount: calibrationQuestions.length,
    }, 'Cross-source connector synthesis completed');

    return {
      skipped: false,
      sourcesAnalyzed: bundles.map((bundle) => bundle.sourceId),
      assertionsCreated,
      knowledgeUpdated,
      writingPreferencesPersisted,
      calibrationQuestions,
    };
  } catch (error) {
    finishContextExtractionRun({ runId: extraction.run.id, status: 'failed', errorCode: 'extractor_failed' });
    throw error;
  }
}
