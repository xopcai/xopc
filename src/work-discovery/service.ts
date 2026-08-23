import { createHash, randomUUID } from 'node:crypto';

import type { Config } from '../config/schema.js';
import { getAgentDefaultModelRef } from '../config/schema.js';
import { ActivityService } from '../activity/service.js';
import type { ProjectService } from '../projects/project-service.js';
import { buildSessionKey } from '../routing/session-key.js';
import { getDefaultAgentId } from '../routing/resolve-route.js';
import type { SessionIndex } from '../session/manager.js';
import {
  createContextEvidence,
  createUnderstanding,
  getUnderstanding,
  linkUnderstandingEvidence,
  listUnderstandingEvidence,
  listUnderstandings,
  rejectUnderstanding,
  reviseUnderstanding,
  setUnderstandingStatus,
  type SessionMetadataSeed,
} from '../storage/sqlite/index.js';
import type { UnderstandingKind, UserContextScope, UserUnderstanding } from '../user-context/domain.js';
import { clusterActivityTopics } from '../user-context/sources/activity-clustering.js';
import {
  createUnderstandingSourceRun,
  getUnderstandingSourceRun,
  listUserFocuses,
  setUserFocusStatus,
  upsertUnderstandingSourceGrant,
  upsertUserFocus,
  updateUnderstandingSourceRun,
  updateUnderstandingSourceGrantCheckpoint,
} from '../user-context/sources/repository.js';
import type { UnderstandingSourceCategory, UnderstandingSourceItem } from '../user-context/sources/types.js';
import { isLocalUnderstandingSourceId } from '../user-context/sources/local-source-contract.js';
import { createLogger } from '../utils/logger.js';

import { analyzeUnderstandingSources, analyzeWorkContext, workDiscoveryResultMarkdown } from './analyzer.js';
import { discoverWorkCandidates } from './candidate-discovery.js';
import { workDiscoveryFingerprintsEqual } from './incremental.js';
import {
  findActiveWorkDiscoverySourceRefresh,
  recordWorkDiscoverySourceRefresh,
  updateWorkDiscoverySourceRefreshForRun,
} from './incremental-repository.js';
import {
  appendWorkUnderstandingEvidence,
  getWorkUnderstandingInvestigationForRun,
  listWorkUnderstandingEvidence,
} from './investigation-repository.js';
import { investigateWorkContext } from './investigator.js';
import { persistWorkThreadsFromDiscovery } from './thread-service.js';
import {
  createWorkDiscoveryRun,
  getWorkDiscoveryOnboardingState,
  getWorkDiscoveryRun,
  getWorkDiscoveryRunByIdempotencyKey,
  setWorkDiscoveryFeedback,
  setWorkDiscoveryOnboardingState,
  updateWorkDiscoveryRun,
} from './repository.js';
import {
  getWorkDiscoveryDirectorySource,
  listWorkDiscoveryDirectorySources,
  revokeWorkDiscoveryDirectorySource,
  upsertWorkDiscoveryDirectorySource,
} from './source-repository.js';
import {
  probeWorkDiscoveryRoot,
  previewWorkDiscoveryRoot,
  summarizeWorkContextSnapshot,
  WORK_DISCOVERY_SCAN_POLICY_VERSION,
} from './probe.js';
import type {
  WorkDiscoveryErrorCode,
  WorkDiscoveryCandidate,
  WorkDiscoveryOnboardingState,
  WorkDiscoveryProfileCandidate,
  WorkDiscoveryRecognitionDecision,
  WorkDiscoveryRun,
  WorkDiscoverySource,
} from './types.js';

const log = createLogger('WorkDiscovery');
function understandingKind(category: WorkDiscoveryProfileCandidate['category']): UnderstandingKind {
  if (category === 'preference') return 'preference';
  if (category === 'workflow') return 'routine';
  if (category === 'focus') return 'current_state';
  return 'project_context';
}

function understandingKey(candidate: WorkDiscoveryProfileCandidate): string {
  const normalized = candidate.statement.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return `work-discovery:${candidate.category}:${createHash('sha256').update(normalized).digest('hex').slice(0, 20)}`;
}

function sameScope(left: UserContextScope, right: UserContextScope): boolean {
  return left.type === right.type && left.id === right.id;
}

function persistUnderstandingCandidate(
  candidate: WorkDiscoveryProfileCandidate,
  scope: UserContextScope,
  sourceRef: string,
): UserUnderstanding {
  const canonicalKey = understandingKey(candidate);
  const existing = listUnderstandings().find((item) => item.canonicalKey === canonicalKey && sameScope(item.scope, scope));
  if (existing) return existing;
  const evidence = createContextEvidence({
    sourceType: 'runtime', sourceRef: `${sourceRef}:${candidate.id}`,
    redactedExcerpt: candidate.evidence.join(' · ').slice(0, 600), trustLevel: 'trusted', observedAt: Date.now(),
  });
  const understanding = createUnderstanding({
    kind: understandingKind(candidate.category), canonicalKey, status: 'candidate', scope,
    explicitness: 'inferred',
    durability: candidate.category === 'focus' ? 'ephemeral' : candidate.category === 'workflow' ? 'recurring' : 'durable',
    sensitivity: 'normal', disclosurePolicy: 'referenceable',
    confidence: candidate.confidence === 'high' ? 0.9 : candidate.confidence === 'medium' ? 0.72 : 0.58,
    statement: candidate.statement, createdBy: 'runtime', changeReason: 'work discovery inference',
  });
  linkUnderstandingEvidence(understanding.versionId, evidence.id, 'supports', understanding.confidence);
  return understanding;
}

function decideUnderstanding(input: {
  understandingId: string;
  status: 'accepted' | 'edited' | 'rejected';
  statement?: string;
}, expectedSourcePrefix: string): UserUnderstanding | undefined {
  const current = getUnderstanding(input.understandingId);
  const owned = current && listUnderstandingEvidence(current.id)
    .some((evidence) => evidence.sourceRef.startsWith(expectedSourcePrefix));
  if (!current || !owned || current.status === 'archived') return undefined;
  if (input.status === 'rejected') return rejectUnderstanding(current.id, 'Rejected from work discovery review');
  const statement = input.status === 'edited' ? input.statement?.trim().slice(0, 500) : undefined;
  if (input.status === 'edited' && !statement) return undefined;
  const revised = statement
    ? reviseUnderstanding(current.id, statement, {
        explicitness: 'explicit',
        confidence: 1,
        changeReason: 'Edited during work discovery review',
      })
    : current;
  return setUnderstandingStatus(revised.id, 'active', { explicitness: 'explicit', confidence: 1 });
}

export interface WorkDiscoveryServiceOptions {
  projects: ProjectService;
  sessions: SessionIndex;
  getConfig: () => Config;
  emit: (type: string, payload: unknown) => void;
}

function sessionMetadata(agentId: string, peerId: string): SessionMetadataSeed {
  return {
    sourceChannel: 'webchat',
    sourceChatId: ['default', 'direct', peerId].join(':'),
    sessionType: 'chat',
    hiddenFromSessionList: true,
    routing: {
      agentId,
      source: 'webchat',
      accountId: 'default',
      peerKind: 'direct',
      peerId,
    },
    customData: {
      workDiscovery: true,
      genericNewChatShell: false,
    },
  };
}

function errorCode(error: unknown): WorkDiscoveryErrorCode {
  if (error instanceof DOMException && error.name === 'AbortError') return 'canceled';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('api key') || message.includes('model') || message.includes('provider')) return 'model_unavailable';
  if (message.includes('directory') || message.includes('folder') || message.includes('enoent')) return 'folder_unavailable';
  if (message.includes('permission') || message.includes('eacces')) return 'folder_not_readable';
  if (message.includes('json') || message.includes('analysis result')) return 'analysis_invalid';
  if (message.includes('timeout')) return 'analysis_timeout';
  return 'internal_error';
}

function hasLongVerbatimOverlap(value: string, sources: string[], minimumLength = 32): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length < minimumLength) return false;
  const sourceText = sources.map((source) => source.replace(/\s+/g, ' '));
  for (let index = 0; index <= normalized.length - minimumLength; index += Math.max(1, Math.floor(minimumLength / 2))) {
    const fragment = normalized.slice(index, index + minimumLength);
    if (sourceText.some((source) => source.includes(fragment))) return true;
  }
  return false;
}

export class WorkDiscoveryService {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly candidateContexts = new Map<string, WorkDiscoveryCandidate[]>();
  private readonly activity = new ActivityService();

  constructor(private readonly options: WorkDiscoveryServiceOptions) {}

  isEnabled(): boolean {
    return this.options.getConfig().experimental?.workDiscoveryOnboarding === true;
  }

  getOnboardingState(): WorkDiscoveryOnboardingState {
    return getWorkDiscoveryOnboardingState();
  }

  dismissOnboarding(): WorkDiscoveryOnboardingState {
    return setWorkDiscoveryOnboardingState({ status: 'dismissed', activeRunId: null });
  }

  getRun(id: string): WorkDiscoveryRun | null {
    return getWorkDiscoveryRun(id);
  }

  getInvestigation(runId: string) {
    const investigation = getWorkUnderstandingInvestigationForRun(runId);
    return investigation
      ? { investigation, evidence: listWorkUnderstandingEvidence(investigation.id) }
      : null;
  }

  async discoverCandidates(signal?: AbortSignal) {
    const existingProjects = this.options.projects.list({ status: 'active', limit: 500 }).items.map((project) => ({
      id: project.id,
      workspaceRoot: project.workspaceRoot,
    }));
    const approvedDirectories = listWorkDiscoveryDirectorySources().map((source) => ({
      id: source.id,
      rootPath: source.rootPath,
    }));
    return discoverWorkCandidates({ existingProjects, approvedDirectories, signal });
  }

  listDirectorySources() {
    return listWorkDiscoveryDirectorySources();
  }

  async grantDirectorySource(rootPath: string) {
    const preview = await previewWorkDiscoveryRoot(rootPath);
    return upsertWorkDiscoveryDirectorySource({
      rootPath: preview.canonicalRootPath,
      displayName: preview.displayName,
      fingerprint: preview.fingerprint,
    });
  }

  async checkDirectorySources() {
    const checks = [];
    for (const source of listWorkDiscoveryDirectorySources()) {
      try {
        const preview = await previewWorkDiscoveryRoot(source.rootPath);
        checks.push(recordWorkDiscoverySourceRefresh({
          sourceId: source.id,
          changed: !workDiscoveryFingerprintsEqual(source.fingerprint, preview.fingerprint),
          previousFingerprint: source.fingerprint,
          currentFingerprint: preview.fingerprint,
        }));
      } catch (error) {
        log.warn({ err: error, sourceId: source.id, path: source.rootPath }, 'Work source change check failed');
      }
    }
    return checks;
  }

  async refreshDirectorySourceIfChanged(input: { id: string; idempotencyKey: string }) {
    const source = getWorkDiscoveryDirectorySource(input.id);
    if (!source || source.status !== 'active') throw new Error('Approved work folder not found');
    const preview = await previewWorkDiscoveryRoot(source.rootPath);
    const changed = !workDiscoveryFingerprintsEqual(source.fingerprint, preview.fingerprint);
    if (!changed) {
      return {
        changed: false,
        refresh: recordWorkDiscoverySourceRefresh({
          sourceId: source.id,
          changed: false,
          previousFingerprint: source.fingerprint,
          currentFingerprint: preview.fingerprint,
        }),
      };
    }
    const activeRefresh = findActiveWorkDiscoverySourceRefresh(source.id, preview.fingerprint);
    const activeRun = activeRefresh?.discoveryRunId
      ? getWorkDiscoveryRun(activeRefresh.discoveryRunId)
      : null;
    if (activeRefresh && activeRun) {
      return { changed: true, reused: true, refresh: activeRefresh, run: activeRun };
    }
    const run = await this.startRun({
      rootPath: preview.canonicalRootPath,
      source: 'manual_selected_directory',
      idempotencyKey: input.idempotencyKey,
    });
    return {
      changed: true,
      run,
      refresh: recordWorkDiscoverySourceRefresh({
        sourceId: source.id,
        changed: true,
        previousFingerprint: source.fingerprint,
        currentFingerprint: preview.fingerprint,
        status: 'queued',
        discoveryRunId: run.id,
      }),
    };
  }

  revokeDirectorySource(id: string) {
    return revokeWorkDiscoveryDirectorySource(id);
  }

  async importUnderstandingSources(
    rawItems: unknown[],
    signal?: AbortSignal,
    runId?: string,
    rawCheckpoints?: Record<string, unknown>,
  ) {
    let remaining = 300_000;
    const itemTypes = new Set<UnderstandingSourceItem['type']>([
      'document', 'calendar_event', 'task', 'note', 'mail', 'message', 'code_activity', 'bookmark',
    ]);
    const ownerAttributions = new Set<UnderstandingSourceItem['ownerAttribution']>(['user', 'other', 'shared', 'unknown']);
    const sensitivities = new Set<UnderstandingSourceItem['sensitivity']>(['normal', 'personal', 'secret', 'regulated']);
    const items: UnderstandingSourceItem[] = rawItems.flatMap((value) => {
      if (!value || typeof value !== 'object' || remaining <= 0) return [];
      const raw = value as Record<string, unknown>;
      const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 500) : '';
      const sourceId = typeof raw.sourceId === 'string' ? raw.sourceId.trim().slice(0, 200) : '';
      const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 300) : '';
      const type = typeof raw.type === 'string' && itemTypes.has(raw.type as UnderstandingSourceItem['type'])
        ? raw.type as UnderstandingSourceItem['type'] : null;
      const evidenceRef = typeof raw.evidenceRef === 'string' ? raw.evidenceRef.trim().slice(0, 1_000) : '';
      const ownerAttribution = typeof raw.ownerAttribution === 'string'
        && ownerAttributions.has(raw.ownerAttribution as UnderstandingSourceItem['ownerAttribution'])
        ? raw.ownerAttribution as UnderstandingSourceItem['ownerAttribution'] : 'unknown';
      const sensitivity = typeof raw.sensitivity === 'string'
        && sensitivities.has(raw.sensitivity as UnderstandingSourceItem['sensitivity'])
        ? raw.sensitivity as UnderstandingSourceItem['sensitivity'] : 'personal';
      if (!id || !isLocalUnderstandingSourceId(sourceId) || !title || !type
        || !evidenceRef.startsWith(`${sourceId}://`)
        || sensitivity === 'secret' || sensitivity === 'regulated') return [];
      const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, Math.min(12_000, remaining)) : '';
      remaining -= text.length;
      const timestamp = (key: string) => {
        const candidate = raw[key];
        return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
      };
      const resourceUri = (() => {
        if (typeof raw.resourceUri !== 'string') return undefined;
        try {
          const url = new URL(raw.resourceUri.trim());
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
            || url.search || url.hash || (url.pathname && url.pathname !== '/')) return undefined;
          return url.origin.slice(0, 1_000);
        } catch {
          return undefined;
        }
      })();
      return [{
        id, sourceId, type, title, ownerAttribution, sensitivity, evidenceRef,
        ...(text ? { text } : {}),
        ...(typeof raw.group === 'string' && raw.group.trim() ? { group: raw.group.trim().slice(0, 200) } : {}),
        ...(resourceUri ? { resourceUri } : {}),
        ...(timestamp('occurredAt') != null ? { occurredAt: timestamp('occurredAt') } : {}),
        ...(timestamp('modifiedAt') != null ? { modifiedAt: timestamp('modifiedAt') } : {}),
        ...(timestamp('startsAt') != null ? { startsAt: timestamp('startsAt') } : {}),
        ...(timestamp('endsAt') != null ? { endsAt: timestamp('endsAt') } : {}),
      }];
    }).slice(0, 150);
    if (!items.length) throw new Error('No readable understanding source items were provided');

    const checkpoints = new Map<string, { fingerprint: string; collectedAt: number }>();
    for (const [sourceId, value] of Object.entries(rawCheckpoints ?? {})) {
      if (!isLocalUnderstandingSourceId(sourceId) || !value || typeof value !== 'object') continue;
      const raw = value as Record<string, unknown>;
      if (typeof raw.fingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.fingerprint)
        || typeof raw.collectedAt !== 'number' || !Number.isFinite(raw.collectedAt) || raw.collectedAt <= 0) continue;
      checkpoints.set(sourceId, {
        fingerprint: raw.fingerprint.toLowerCase(),
        collectedAt: Math.min(raw.collectedAt, Date.now()),
      });
    }

    const sourceRuns = new Map<string, string>();
    const sourceGrants = new Map<string, ReturnType<typeof upsertUnderstandingSourceGrant>>();
    const changedSourceIds = new Set<string>();
    for (const sourceId of new Set(items.map((item) => item.sourceId))) {
      const sourceItems = items.filter((item) => item.sourceId === sourceId);
      const category: UnderstandingSourceCategory = sourceItems.some((item) => item.type === 'calendar_event') ? 'calendar'
        : sourceItems.some((item) => item.type === 'task') ? 'tasks'
          : sourceItems.some((item) => item.type === 'note') ? 'notes'
            : sourceItems.some((item) => item.type === 'mail') ? 'mail'
              : sourceItems.some((item) => item.type === 'message') ? 'messages'
                : sourceItems.some((item) => item.type === 'code_activity') ? 'code_activity'
                  : 'recent_documents';
      const platform = sourceId.startsWith('apple-') ? 'darwin'
        : sourceId.startsWith('windows-') ? 'win32'
          : sourceId.startsWith('linux-') ? 'linux' : 'all';
      const grant = upsertUnderstandingSourceGrant({
        sourceKey: `understanding-source:${sourceId}`,
        adapterId: sourceId,
        category,
        platform,
        displayName: sourceId,
        accessMode: 'once',
        retentionPolicy: 'derived_only',
        processingPolicy: 'remote_allowed',
        config: { readOnly: true },
      });
      sourceGrants.set(sourceId, grant);
      const checkpoint = checkpoints.get(sourceId);
      const previousFingerprint = typeof grant.checkpoint.fingerprint === 'string' ? grant.checkpoint.fingerprint : undefined;
      const unchanged = Boolean(checkpoint && previousFingerprint === checkpoint.fingerprint);
      const kind = !previousFingerprint ? 'bootstrap' : unchanged ? 'fingerprint' : 'incremental';
      const sourceRun = createUnderstandingSourceRun({
        grantId: grant.id,
        kind,
        ...(previousFingerprint ? { cursorBefore: previousFingerprint } : {}),
        metadata: { sourceId, unchanged },
      });
      sourceRuns.set(sourceId, sourceRun.id);
      if (unchanged) {
        updateUnderstandingSourceRun(sourceRun.id, {
          status: 'completed',
          cursorAfter: checkpoint!.fingerprint,
          itemsSeen: sourceItems.length,
          completed: true,
        });
        updateUnderstandingSourceGrantCheckpoint(grant.id, {
          checkpoint: { ...grant.checkpoint, ...checkpoint, lastRunId: sourceRun.id },
          lastCollectedAt: checkpoint!.collectedAt,
        });
        continue;
      }
      changedSourceIds.add(sourceId);
    }

    if (!changedSourceIds.size) {
      log.info({ runId, itemCount: items.length }, 'Understanding sources unchanged; analysis skipped');
      return { profileCandidates: [], workThreads: [], focuses: [] };
    }
    // Reuse every bounded item when any source changed so cross-source clusters remain coherent.
    const analysisItems = items;

    const linkedRun = runId ? getWorkDiscoveryRun(runId) : null;
    let analysis: Awaited<ReturnType<typeof analyzeUnderstandingSources>>;
    try {
      analysis = await analyzeUnderstandingSources({
        config: this.options.getConfig(), items: analysisItems,
        ...(linkedRun?.result ? { workContext: {
          projectSummary: linkedRun.result.projectSummary,
          currentState: linkedRun.result.currentState,
          uncertainties: linkedRun.result.uncertainties,
          workThreads: linkedRun.result.workThreads,
        } } : {}),
        signal,
      });
      for (const [sourceId, sourceRunId] of sourceRuns) {
        if (!changedSourceIds.has(sourceId)) continue;
        updateUnderstandingSourceRun(sourceRunId, {
          status: 'completed',
          cursorAfter: checkpoints.get(sourceId)?.fingerprint,
          itemsSeen: analysisItems.filter((item) => item.sourceId === sourceId).length,
          completed: true,
          metadata: { sourceId },
        });
        const sourceRun = getUnderstandingSourceRun(sourceRunId);
        if (sourceRun) {
          const grant = sourceGrants.get(sourceId);
          const checkpoint = checkpoints.get(sourceId);
          updateUnderstandingSourceGrantCheckpoint(sourceRun.grantId, {
            checkpoint: { ...(grant?.checkpoint ?? {}), ...(checkpoint ?? {}), lastRunId: sourceRunId },
            lastCollectedAt: checkpoint?.collectedAt ?? Date.now(),
          });
        }
      }
    } catch (error) {
      for (const [sourceId, sourceRunId] of sourceRuns) {
        if (!changedSourceIds.has(sourceId)) continue;
        updateUnderstandingSourceRun(sourceRunId, {
          status: signal?.aborted ? 'canceled' : 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          completed: true,
        });
      }
      throw error;
    }
    const rawContents = analysisItems.flatMap((item) => item.text ? [item.text] : []);
    const activityTopics = clusterActivityTopics(analysisItems);
    const safeProfileCandidates = analysis.profileCandidates
      .filter((candidate) => !hasLongVerbatimOverlap(candidate.statement, rawContents));
    const safeWorkThreadCandidates = analysis.workThreadCandidates.filter((candidate) =>
      !hasLongVerbatimOverlap(candidate.title, rawContents)
      && !hasLongVerbatimOverlap(candidate.summary, rawContents));
    const profileCandidates = safeProfileCandidates.map((candidate) => {
      const understanding = persistUnderstandingCandidate(candidate, { type: 'global' }, 'understanding-source:onboarding');
      const evidenceSourceIds = new Set((candidate.evidenceRefs ?? []).map((ref) => ref.split('://', 1)[0]).filter(Boolean));
      for (const sourceId of evidenceSourceIds) {
        const sourceRunId = sourceRuns.get(sourceId);
        if (!sourceRunId) continue;
        const sourceRun = getUnderstandingSourceRun(sourceRunId);
        if (!sourceRun) continue;
        const evidence = createContextEvidence({
          sourceType: 'runtime',
          sourceRef: `understanding-source-grant:${sourceRun.grantId}:${candidate.id}`,
          redactedExcerpt: candidate.evidence.join(' · ').slice(0, 600),
          trustLevel: 'trusted',
          observedAt: Date.now(),
        });
        linkUnderstandingEvidence(understanding.versionId, evidence.id, 'supports', understanding.confidence);
      }
      return {
        ...candidate,
        status: understanding.status === 'rejected' ? 'rejected' as const : 'pending' as const,
        understandingId: understanding.id,
      };
    });
    const investigation = linkedRun ? getWorkUnderstandingInvestigationForRun(linkedRun.id) : null;
    const contextEvidence = investigation
      ? safeWorkThreadCandidates.map((candidate) => {
        const topicHash = createHash('sha256').update(candidate.topicKey).digest('hex').slice(0, 16);
        return appendWorkUnderstandingEvidence({
          investigationId: investigation.id,
          projectId: linkedRun!.projectId,
          sourceType: 'understanding_source',
          sourceRef: `understanding-source://thread/${topicHash}`,
          observation: candidate.summary,
          contentHash: createHash('sha256').update(JSON.stringify(candidate.evidenceRefs)).digest('hex'),
          sensitivity: 'normal',
        });
      })
      : [];
    const workThreads = linkedRun && contextEvidence.length
      ? persistWorkThreadsFromDiscovery({
        projectId: linkedRun.projectId,
        result: {
          projectSummary: 'Connected source context',
          currentState: 'Work streams inferred from sources the user explicitly connected.',
          uncertainties: [],
          suggestions: [],
          workThreadCandidates: safeWorkThreadCandidates.map((candidate, index) => ({
            ...candidate,
            evidenceRefs: contextEvidence[index] ? [contextEvidence[index].sourceRef] : [],
          })),
        },
        snapshot: {
          root: { displayName: 'Connected Sources', projectKind: 'general', markerReasons: ['explicitly_connected_understanding_sources'] },
          structure: { sampledPaths: [], metadataOnlyFiles: [], omittedPathCount: 0 },
          documents: [],
          limits: { policyVersion: WORK_DISCOVERY_SCAN_POLICY_VERSION, fileCount: 0, contentBytes: 0, truncated: false },
        },
        evidence: contextEvidence,
      })
      : [];
    const activityEvidence = new Set(activityTopics.flatMap((topic) => topic.evidenceRefs));
    const activityFocuses = activityTopics.map((topic) => upsertUserFocus({
      canonicalKey: topic.canonicalKey,
      title: topic.title,
      summary: topic.summary,
      horizon: topic.horizon,
      status: 'candidate',
      confidence: topic.confidence,
      evidenceRefs: topic.evidenceRefs,
      sourceRunId: sourceRuns.get(topic.sourceIds[0] ?? ''),
    }));
    const modelFocuses = safeWorkThreadCandidates
      .filter((candidate) => !candidate.evidenceRefs.some((ref) => activityEvidence.has(ref)))
      .map((candidate) => upsertUserFocus({
      canonicalKey: `source-focus:${candidate.topicKey}`,
      title: candidate.title,
      summary: candidate.summary,
      horizon: candidate.horizon,
      status: 'candidate',
      confidence: candidate.confidence === 'high' ? 0.9 : candidate.confidence === 'medium' ? 0.72 : 0.55,
      evidenceRefs: candidate.evidenceRefs,
      sourceRunId: sourceRuns.get(candidate.evidenceRefs[0]?.split('://', 1)[0] ?? ''),
    }));
    const focuses = [...activityFocuses, ...modelFocuses];
    log.info({ runId, itemCount: items.length, candidateCount: profileCandidates.length, focusCount: focuses.length }, 'Understanding sources analyzed');
    return {
      profileCandidates,
      workThreads,
      focuses,
    };
  }

  updateUnderstandingSourceProfile(input: {
    decisions: Array<{ understandingId: string; status: 'accepted' | 'edited' | 'rejected'; statement?: string }>;
  }) {
    return input.decisions.flatMap((decision) => {
      const updated = decideUnderstanding(decision, 'understanding-source:');
      return updated ? [{ understandingId: updated.id, status: decision.status, statement: updated.statement }] : [];
    });
  }

  async rescanDirectorySource(input: { id: string; idempotencyKey: string }) {
    const source = getWorkDiscoveryDirectorySource(input.id);
    if (!source || source.status !== 'active') throw new Error('Approved work folder not found');
    const preview = await previewWorkDiscoveryRoot(source.rootPath);
    upsertWorkDiscoveryDirectorySource({
      rootPath: preview.canonicalRootPath,
      displayName: preview.displayName,
      fingerprint: preview.fingerprint,
    });
    return this.startRun({
      rootPath: preview.canonicalRootPath,
      source: 'manual_selected_directory',
      idempotencyKey: input.idempotencyKey,
    });
  }

  async startQuickRun(input: { idempotencyKey: string }): Promise<WorkDiscoveryRun> {
    const candidates = await this.discoverCandidates();
    const primary = candidates[0];
    if (!primary) throw new Error('No accessible work projects were found');
    return this.startRun({
      rootPath: primary.rootPath,
      source: 'onboarding_selected_directory',
      idempotencyKey: input.idempotencyKey,
      candidateContext: candidates,
    });
  }

  async startRun(input: {
    rootPath: string;
    source: WorkDiscoverySource;
    idempotencyKey: string;
    candidateContext?: WorkDiscoveryCandidate[];
  }): Promise<WorkDiscoveryRun> {
    const existing = getWorkDiscoveryRunByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const config = this.options.getConfig();
    const modelRef = getAgentDefaultModelRef(config);
    if (!modelRef) throw new Error('No default model configured');

    const preview = await previewWorkDiscoveryRoot(input.rootPath);
    const rootPath = preview.canonicalRootPath;
    const agentId = getDefaultAgentId(config);
    const match = this.options.projects.resolveOrCreateForWorkspacePath({
      workspacePath: rootPath,
      defaultAgentId: agentId,
      autoCreate: true,
    });
    if (!match) throw new Error('Selected folder cannot be used as a project workspace');
    const projectAgentId = match.project.defaultAgentId || agentId;
    const peerId = `work-discovery-${randomUUID()}`;
    const sessionKey = buildSessionKey({
      agentId: projectAgentId,
      source: 'webchat',
      accountId: 'default',
      peerKind: 'direct',
      peerId,
    });
    await this.options.sessions.saveMessages(sessionKey, [], {
      metadata: sessionMetadata(projectAgentId, peerId),
    });
    this.options.projects.attachSession(sessionKey, match.project.id);
    const now = Date.now();
    const run = createWorkDiscoveryRun({
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      status: 'queued',
      rootPath,
      projectId: match.project.id,
      sessionKey,
      agentId: projectAgentId,
      modelRef,
      scanPolicyVersion: WORK_DISCOVERY_SCAN_POLICY_VERSION,
      createdAt: now,
    });
    await this.options.sessions.appendTranscriptContextEntry(sessionKey, {
      text: 'Work discovery was explicitly requested for the selected folder.',
      data: {
        type: 'work_discovery',
        runId: run.id,
        rootPath,
        scanPolicyVersion: WORK_DISCOVERY_SCAN_POLICY_VERSION,
        source: input.source,
      },
    });
    if (input.source === 'onboarding_selected_directory') {
      setWorkDiscoveryOnboardingState({ status: 'in_progress', activeRunId: run.id });
    }
    this.activity.record({
      type: 'work_discovery.started',
      primaryObject: { kind: 'project', id: match.project.id, title: match.project.name },
      actor: { kind: 'system' },
      initiator: { kind: 'user', sessionKey },
      source: { kind: 'gateway_api', runId: run.id },
      visibility: 'audit',
      payload: { policyVersion: WORK_DISCOVERY_SCAN_POLICY_VERSION, source: input.source },
      scopes: [
        { scopeKind: 'project', scopeId: match.project.id, reason: 'object_owner' },
        { scopeKind: 'session', scopeId: sessionKey, reason: 'runtime_context' },
      ],
    });
    const controller = new AbortController();
    this.abortControllers.set(run.id, controller);
    if (input.candidateContext?.length) {
      this.candidateContexts.set(run.id, input.candidateContext.slice(0, 8));
    }
    void this.execute(run, controller.signal);
    return run;
  }

  private publish(run: WorkDiscoveryRun): void {
    const suffix = run.status === 'completed'
      ? 'completed'
      : run.status === 'failed'
        ? 'failed'
        : run.status === 'canceled'
          ? 'canceled'
          : 'progress';
    this.options.emit(`work-discovery.${suffix}`, {
      runId: run.id,
      projectId: run.projectId,
      sessionKey: run.sessionKey,
      status: run.status,
      stage: run.stage,
      ...(run.status === 'completed' ? { result: run.result } : {}),
    });
  }

  private async execute(run: WorkDiscoveryRun, signal: AbortSignal): Promise<void> {
    const startedAt = Date.now();
    try {
      let current = updateWorkDiscoveryRun(run.id, {
        status: 'probing',
        stage: 'folder_structure',
        startedAt,
      })!;
      this.publish(current);
      const snapshot = await probeWorkDiscoveryRoot(run.rootPath, signal);
      if (signal.aborted) throw new DOMException('Work discovery canceled', 'AbortError');
      current = updateWorkDiscoveryRun(run.id, {
        status: 'analyzing',
        stage: 'recent_progress',
        snapshot: summarizeWorkContextSnapshot(snapshot),
      })!;
      this.publish(current);
      const approvedSource = listWorkDiscoveryDirectorySources().find((source) => source.rootPath === run.rootPath);
      const investigation = await investigateWorkContext({
        config: this.options.getConfig(),
        snapshot,
        rootPath: run.rootPath,
        discoveryRunId: run.id,
        projectId: run.projectId,
        ...(approvedSource ? { sourceGrantId: approvedSource.id } : {}),
        signal,
      });
      const investigatedSnapshot = {
        ...snapshot,
        documents: investigation.documents,
        limits: {
          ...snapshot.limits,
          contentBytes: investigation.documents.reduce((sum, document) => sum + document.excerpt.length, 0),
          truncated: snapshot.limits.truncated || investigation.degraded,
        },
      };
      const candidateContext = this.candidateContexts.get(run.id)
        ?? (run.source === 'onboarding_selected_directory' ? await this.discoverCandidates(signal) : undefined);
      const unifiedEvidence = [...investigation.evidence];
      for (const candidate of candidateContext ?? []) {
        if (candidate.rootPath === run.rootPath) continue;
        const sourceRef = candidate.projectId
          ? `project://${candidate.projectId}`
          : `project-candidate://${createHash('sha256').update(candidate.rootPath).digest('hex').slice(0, 16)}`;
        unifiedEvidence.push(appendWorkUnderstandingEvidence({
          investigationId: investigation.investigation.id,
          ...(candidate.projectId ? { projectId: candidate.projectId } : {}),
          sourceType: 'project_metadata',
          sourceRef,
          observation: `${candidate.displayName} is a related work area with ${candidate.changedFileCount} changed files and activity score ${candidate.score}.`,
          contentHash: createHash('sha256')
            .update(JSON.stringify({ score: candidate.score, branch: candidate.branch, changedFileCount: candidate.changedFileCount }))
            .digest('hex'),
          ...(candidate.lastActiveAt ? { observedAt: candidate.lastActiveAt } : {}),
          sensitivity: 'normal',
        }));
      }
      const analysis = await analyzeWorkContext({
        config: this.options.getConfig(),
        snapshot: investigatedSnapshot,
        ...(candidateContext?.length ? { candidateContext } : {}),
        signal,
      });
      const discoveredProjects = candidateContext?.map((candidate) => ({
        rootPath: candidate.rootPath,
        displayName: candidate.displayName,
        score: candidate.score,
        projectKind: candidate.projectKind,
        ...(candidate.lastActiveAt ? { lastActiveAt: candidate.lastActiveAt } : {}),
        evidence: candidate.evidence,
      }));
      const baseResult = {
        ...analysis.result,
        investigation: {
          id: investigation.investigation.id,
          hypotheses: investigation.investigation.plan.hypotheses,
          questions: investigation.investigation.plan.questions,
          toolCallCount: investigation.investigation.toolCallCount,
          contentCharsRead: investigation.investigation.contentCharsRead,
          degraded: investigation.degraded,
        },
        ...(discoveredProjects?.length ? { discoveredProjects } : {}),
      };
      const workThreads = persistWorkThreadsFromDiscovery({
        projectId: run.projectId,
        result: baseResult,
        snapshot: investigatedSnapshot,
        evidence: unifiedEvidence,
      });
      for (const thread of workThreads) {
        upsertUserFocus({
          canonicalKey: `work-focus:${thread.canonicalKey}`,
          title: thread.title,
          summary: thread.summary,
          horizon: thread.horizon,
          status: 'candidate',
          confidence: thread.confidence,
          projectId: run.projectId,
          evidenceRefs: thread.evidenceIds,
        });
      }
      const result = this.persistProfileCandidates(run, {
        ...baseResult,
        ...(workThreads.length ? { workThreads } : {}),
      });
      current = updateWorkDiscoveryRun(run.id, { status: 'analyzing', stage: 'next_steps' })!;
      this.publish(current);
      await this.options.sessions.appendTranscriptCustomMessageEntry(run.sessionKey, {
        customType: 'work-discovery-result',
        content: workDiscoveryResultMarkdown(result),
        display: true,
        details: { runId: run.id, result },
      });
      const project = this.options.projects.get(run.projectId);
      await this.options.sessions.updateSessionMetadata(run.sessionKey, {
        name: project ? `Continue work on ${project.name}` : 'Continue recent work',
        hiddenFromSessionList: false,
      });
      if (approvedSource) {
        try {
          const preview = await previewWorkDiscoveryRoot(run.rootPath);
          upsertWorkDiscoveryDirectorySource({
            rootPath: preview.canonicalRootPath,
            displayName: preview.displayName,
            fingerprint: preview.fingerprint,
            scanned: true,
          });
        } catch (error) {
          log.debug({ err: error, runId: run.id, phase: 'source_fingerprint' }, 'Work source fingerprint update failed');
        }
      }
      current = updateWorkDiscoveryRun(run.id, {
        status: 'completed',
        stage: 'next_steps',
        result,
        completedAt: Date.now(),
      })!;
      updateWorkDiscoverySourceRefreshForRun(run.id, 'completed');
      this.activity.record({
        type: 'work_discovery.completed',
        primaryObject: { kind: 'project', id: run.projectId, title: project?.name },
        actor: { kind: 'agent', agentId: run.agentId, sessionKey: run.sessionKey },
        initiator: { kind: 'user', sessionKey: run.sessionKey },
        source: { kind: 'system', runId: run.id },
        payload: {
          policyVersion: run.scanPolicyVersion,
          suggestionCount: result.suggestions.length,
          lowConfidence: result.lowConfidence === true,
        },
        scopes: [
          { scopeKind: 'project', scopeId: run.projectId, reason: 'object_owner' },
          { scopeKind: 'session', scopeId: run.sessionKey, reason: 'runtime_context' },
        ],
      });
      this.publish(current);
      this.options.emit('session.transcript_updated', { key: run.sessionKey });
      log.info({ runId: run.id, projectId: run.projectId, sessionKey: run.sessionKey, durationMs: Date.now() - startedAt }, 'Work discovery completed');
    } catch (error) {
      const canceled = signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      const code = canceled ? 'canceled' : errorCode(error);
      const message = canceled ? 'Analysis canceled' : error instanceof Error ? error.message : String(error);
      const current = updateWorkDiscoveryRun(run.id, {
        status: canceled ? 'canceled' : 'failed',
        errorCode: code,
        errorMessage: message,
        ...(canceled ? { canceledAt: Date.now() } : { completedAt: Date.now() }),
      });
      updateWorkDiscoverySourceRefreshForRun(run.id, 'failed');
      if (current) this.publish(current);
      this.activity.record({
        type: canceled ? 'work_discovery.canceled' : 'work_discovery.failed',
        primaryObject: { kind: 'project', id: run.projectId },
        actor: { kind: 'system' },
        initiator: { kind: 'user', sessionKey: run.sessionKey },
        source: { kind: 'system', runId: run.id },
        visibility: 'audit',
        payload: { errorCode: code },
        scopes: [
          { scopeKind: 'project', scopeId: run.projectId, reason: 'object_owner' },
          { scopeKind: 'session', scopeId: run.sessionKey, reason: 'runtime_context' },
        ],
      });
      log.warn({ err: error, runId: run.id, projectId: run.projectId, phase: 'analysis', errorCode: code }, `Work discovery failed: ${message}`);
    } finally {
      this.abortControllers.delete(run.id);
      this.candidateContexts.delete(run.id);
    }
  }

  private persistProfileCandidates(run: WorkDiscoveryRun, result: NonNullable<WorkDiscoveryRun['result']>) {
    if (!result.profileCandidates?.length) return result;
    const profileCandidates = result.profileCandidates.map((candidate) => {
      const understanding = persistUnderstandingCandidate(
        candidate,
        { type: 'project', id: run.projectId },
        `work-discovery:${run.id}`,
      );
      return { ...candidate, understandingId: understanding.id };
    });
    return { ...result, profileCandidates };
  }

  updateProfileCandidates(input: {
    runId: string;
    decisions: Array<{ id: string; status: 'accepted' | 'edited' | 'rejected'; statement?: string }>;
  }): WorkDiscoveryRun | null {
    const run = getWorkDiscoveryRun(input.runId);
    if (!run?.result?.profileCandidates?.length) return null;
    const decisions = new Map(input.decisions.map((decision) => [decision.id, decision]));
    const profileCandidates = run.result.profileCandidates.map((candidate) => {
      const decision = decisions.get(candidate.id);
      if (!decision || !candidate.understandingId) return candidate;
      const updated = decideUnderstanding(
        { understandingId: candidate.understandingId, ...decision },
        `work-discovery:${run.id}:`,
      );
      if (!updated) return candidate;
      return {
        ...candidate,
        statement: updated.statement,
        status: decision.status,
      };
    });
    return updateWorkDiscoveryRun(run.id, { result: { ...run.result, profileCandidates } });
  }

  cancelRun(id: string): WorkDiscoveryRun | null {
    const run = getWorkDiscoveryRun(id);
    if (!run) return null;
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'canceled') return run;
    this.abortControllers.get(id)?.abort();
    return updateWorkDiscoveryRun(id, {
      status: 'canceled',
      errorCode: 'canceled',
      errorMessage: 'Analysis canceled',
      canceledAt: Date.now(),
    });
  }

  retryRun(id: string): WorkDiscoveryRun | null {
    const run = getWorkDiscoveryRun(id);
    if (!run) return null;
    if (run.status !== 'failed' && run.status !== 'canceled') return run;
    const queued = updateWorkDiscoveryRun(id, {
      status: 'queued',
      stage: 'folder_structure',
      errorCode: undefined,
      errorMessage: undefined,
      completedAt: undefined,
      canceledAt: undefined,
    });
    if (!queued) return null;
    const controller = new AbortController();
    this.abortControllers.set(id, controller);
    if (run.source === 'onboarding_selected_directory') {
      setWorkDiscoveryOnboardingState({ status: 'in_progress', activeRunId: id });
    }
    this.publish(queued);
    void this.execute(queued, controller.signal);
    return queued;
  }

  async submitRecognitionFeedback(input: {
    runId: string;
    decision: WorkDiscoveryRecognitionDecision;
    correctedIntent?: string;
  }): Promise<WorkDiscoveryRun | null> {
    const run = getWorkDiscoveryRun(input.runId);
    if (!run || run.status !== 'completed' || !run.result) return null;
    const correctedIntent = input.correctedIntent?.trim().slice(0, 2_000);
    if ((input.decision === 'corrected' || input.decision === 'different_goal') && !correctedIntent) {
      throw new Error('A corrected intent is required for this decision');
    }
    const feedback = setWorkDiscoveryFeedback({
      runId: run.id,
      recognitionDecision: input.decision,
      ...(correctedIntent ? { correctedIntent } : {}),
    });
    if (input.decision === 'confirmed') {
      const focusKeys = new Set((run.result.workThreads ?? []).map((thread) => `work-focus:${thread.canonicalKey}`));
      for (const focus of listUserFocuses(['candidate'])) {
        if (focusKeys.has(focus.canonicalKey)) setUserFocusStatus(focus.id, 'active');
      }
    } else if ((input.decision === 'corrected' || input.decision === 'different_goal') && correctedIntent) {
      upsertUserFocus({
        canonicalKey: `user-focus:${createHash('sha256').update(correctedIntent.toLocaleLowerCase()).digest('hex').slice(0, 20)}`,
        title: correctedIntent.slice(0, 120),
        summary: correctedIntent,
        horizon: 'current',
        status: 'active',
        confidence: 1,
        projectId: run.projectId,
        evidenceRefs: [`session://${createHash('sha256').update(run.sessionKey).digest('hex').slice(0, 16)}/recognition`],
      });
    }
    const investigation = getWorkUnderstandingInvestigationForRun(run.id);
    if (investigation && input.decision !== 'dismissed') {
      const observation = correctedIntent
        ? `The user explicitly stated their current intent: ${correctedIntent}`
        : 'The user explicitly confirmed the inferred current work understanding.';
      appendWorkUnderstandingEvidence({
        investigationId: investigation.id,
        projectId: run.projectId,
        sourceType: 'user_statement',
        sourceRef: `session://${createHash('sha256').update(run.sessionKey).digest('hex').slice(0, 16)}/recognition`,
        observation,
        contentHash: createHash('sha256').update(observation).digest('hex'),
        observedAt: Date.now(),
        sensitivity: 'normal',
      });
    }
    if (run.source === 'onboarding_selected_directory') {
      setWorkDiscoveryOnboardingState({
        status: input.decision === 'dismissed' ? 'dismissed' : 'completed',
        activeRunId: input.decision === 'dismissed' ? null : run.id,
      });
    }
    const feedbackText = correctedIntent
      ? `The user corrected the work discovery understanding: ${correctedIntent}`
      : input.decision === 'confirmed'
        ? 'The user confirmed the work discovery understanding.'
        : 'The user left work discovery without confirming the suggested understanding.';
    await this.options.sessions.appendTranscriptContextEntry(run.sessionKey, {
      text: feedbackText,
      data: {
        type: 'work_discovery_recognition_feedback',
        runId: run.id,
        decision: input.decision,
        ...(correctedIntent ? { correctedIntent } : {}),
      },
    });
    this.activity.record({
      type: `work_discovery.recognition_${input.decision}`,
      primaryObject: { kind: 'project', id: run.projectId },
      actor: { kind: 'user', sessionKey: run.sessionKey },
      source: { kind: 'gateway_api', runId: run.id },
      payload: {
        decision: input.decision,
        corrected: Boolean(correctedIntent),
      },
      scopes: [
        { scopeKind: 'project', scopeId: run.projectId, reason: 'object_owner' },
        { scopeKind: 'session', scopeId: run.sessionKey, reason: 'runtime_context' },
      ],
    });
    this.options.emit('work-discovery.recognition-feedback', {
      runId: run.id,
      projectId: run.projectId,
      sessionKey: run.sessionKey,
      decision: input.decision,
    });
    return { ...run, feedback };
  }

  selectSuggestion(runId: string, suggestionId: string): WorkDiscoveryRun | null {
    const run = getWorkDiscoveryRun(runId);
    const suggestion = run?.result?.suggestions.find((item) => item.id === suggestionId);
    if (!run || !suggestion) return null;
    this.activity.record({
      type: 'work_discovery.suggestion_selected',
      primaryObject: { kind: 'project', id: run.projectId },
      actor: { kind: 'user', sessionKey: run.sessionKey },
      source: { kind: 'gateway_api', runId },
      payload: { suggestionId, title: suggestion.title },
      scopes: [
        { scopeKind: 'project', scopeId: run.projectId, reason: 'object_owner' },
        { scopeKind: 'session', scopeId: run.sessionKey, reason: 'runtime_context' },
      ],
    });
    return run;
  }
}
