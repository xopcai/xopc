import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { HomeAdviceMetrics, HomeAdvisor, HomeOpportunityHistoryItem } from '@xopcai/gateway-contract';
import type { HomeOpportunityActionRequest, HomeOpportunityActionResponse, HomeOpportunityFeedbackRequest } from '@xopcai/gateway-contract';

import { createLogger } from '../utils/logger.js';
import type { HomeAdviceGenerator, HomeModelGeneration } from './generator.js';
import { HomeAdvicePolicy } from './policy.js';
import {
  HomeIntelligenceRepository,
  type HomeGenerationReason,
  type HomePrincipal,
} from './repository.js';
import { HomeSnapshotBuilder } from './snapshot.js';
import type { HomeCapabilityInventory } from './types.js';
import { HomeOpportunityApplicationService } from './application-service.js';
import { buildHomeOpportunityNotification, type HomeOpportunityNotification } from './notification.js';
import type {
  HomeCapabilityRequirement,
  HomeCapabilityResolution,
} from './capability-preflight.js';
import { homePatternKey } from './strategy.js';

const log = createLogger('HomeIntelligence');
const POLL_INTERVAL_MS = 5_000;
const GENERATION_LEASE_MS = 5 * 60_000;
const DAILY_MODEL_GENERATION_BUDGET = 12;

function generationFingerprint(snapshotHash: string, capabilities: HomeCapabilityInventory): string {
  return createHash('sha256').update(JSON.stringify({
    snapshotHash,
    agentId: capabilities.agentId,
    connectors: [...capabilities.connectors].sort(),
    skills: [...capabilities.skills].sort(),
  })).digest('hex');
}

export interface HomeIntelligenceHostDeps {
  principal: HomePrincipal;
  snapshot: HomeSnapshotBuilder;
  generator: Pick<HomeAdviceGenerator, 'generate'>;
  capabilities(): HomeCapabilityInventory;
  resolveCapabilities(
    requirements: readonly HomeCapabilityRequirement[],
    options?: { degradedActionAvailable?: boolean },
  ): HomeCapabilityResolution;
  publish(type: string, payload: unknown): void;
  notifyOpportunity(payload: HomeOpportunityNotification): void;
  locale(): 'en' | 'zh';
  enabled?(): boolean;
  dispatchTaskRuns?(): void;
  now?: () => number;
}

export class HomeIntelligenceHost {
  private readonly repository: HomeIntelligenceRepository;
  private readonly opportunities: HomeOpportunityApplicationService;
  private readonly now: () => number;
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  private abortController = new AbortController();
  private localeHint: 'en' | 'zh';

  constructor(db: DatabaseSync, private readonly deps: HomeIntelligenceHostDeps) {
    this.repository = new HomeIntelligenceRepository(db);
    this.opportunities = new HomeOpportunityApplicationService(db, deps.principal, () => deps.capabilities().agentId);
    this.now = deps.now ?? Date.now;
    this.localeHint = deps.locale();
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    this.abortController.abort();
    this.abortController = new AbortController();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  getAdvisor(): HomeAdvisor {
    if (this.deps.enabled?.() === false) return { state: 'disabled' };
    return this.repository.getAdvisor(this.deps.principal, this.now());
  }

  getMetrics(since = Math.max(0, this.now() - 30 * 24 * 60 * 60_000)): HomeAdviceMetrics {
    return this.repository.getMetrics(this.deps.principal, since, this.now());
  }

  getHistory(): HomeOpportunityHistoryItem[] {
    if (this.deps.enabled?.() === false) return [];
    return this.repository.listHistory(this.deps.principal);
  }

  requestRefresh(reason: HomeGenerationReason, idempotencyKey?: string, locale?: string): string {
    if (this.deps.enabled?.() === false) return 'disabled';
    const now = this.now();
    if (locale) this.localeHint = locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    const bucket = Math.floor(now / (reason === 'manual_refresh' ? 1 : 5 * 60_000));
    const request = this.repository.enqueue(this.deps.principal, {
      idempotencyKey: idempotencyKey ?? `${reason}:${bucket}`,
      reasons: [reason],
      requestedAt: now,
    });
    void this.tick();
    return request.generationId;
  }

  sourceChanged(input: { sourceInstanceId: string; revision: string; refresh: boolean }): void {
    const now = this.now();
    const invalidated = this.repository.invalidateOpportunitiesByEvidenceSources(
      this.deps.principal,
      new Set(['calendar', 'mail', 'communication']),
      now,
    );
    if (input.refresh) {
      this.requestRefresh(
        'connector_changed',
        `connector:${input.sourceInstanceId}:${input.revision}`,
      );
    }
    if (invalidated > 0) {
      this.deps.publish('home.advisor.updated', {
        state: 'source_changed',
        sourceInstanceId: input.sourceInstanceId,
        invalidated,
      });
    }
  }

  act(opportunityId: string, input: HomeOpportunityActionRequest): HomeOpportunityActionResponse {
    const request = { opportunityId, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey, now: this.now() };
    if (input.mode !== 'discuss') {
      const opportunity = this.repository.getOpportunity(this.deps.principal, opportunityId, request.now);
      if (!opportunity) return this.opportunities.start(request);
      const resolution = this.resolveCapabilityRequirements(
        opportunity.capabilities,
        Boolean(opportunity.degradedActionPrompt),
      );
      if (input.mode === 'start' && resolution.preflight.state === 'needs_setup') {
        return { outcome: 'needs_setup', preflight: resolution.preflight };
      }
      const degraded = input.mode === 'degraded_start'
        && resolution.preflight.state === 'needs_setup'
        && Boolean(resolution.preflight.degradedAction);
      const result = this.opportunities.start(request, { degraded });
      this.deps.dispatchTaskRuns?.();
      this.deps.publish('home.advisor.updated', { state: 'acted', opportunityId, mode: input.mode });
      return result;
    }
    const result = this.opportunities.discuss(request);
    if (result.outcome === 'task') this.deps.dispatchTaskRuns?.();
    this.deps.publish('home.advisor.updated', { state: 'acted', opportunityId, mode: input.mode });
    return result;
  }

  feedback(opportunityId: string, input: HomeOpportunityFeedbackRequest): void {
    this.opportunities.feedback(opportunityId, {
      idempotencyKey: input.idempotencyKey,
      expectedRevision: input.expectedRevision,
      kind: input.kind,
      createdAt: this.now(),
      reasonCode: input.reasonCode,
      note: input.note,
      snoozedUntil: input.snoozedUntil,
    });
    this.deps.publish('home.advisor.updated', { state: 'feedback', opportunityId, kind: input.kind });
  }

  undoFeedback(opportunityId: string, idempotencyKey: string): void {
    this.repository.undoFeedback(this.deps.principal, opportunityId, idempotencyKey, this.now());
    this.deps.publish('home.advisor.updated', { state: 'feedback_undone', opportunityId });
  }

  async tick(): Promise<void> {
    if (this.running || this.stopped || this.deps.enabled?.() === false) return;
    this.running = true;
    try {
      const now = this.now();
      this.repository.maintain(now);
      const claim = this.repository.claimNext(
        this.deps.principal, `gateway:${process.pid}`, now, GENERATION_LEASE_MS,
      );
      if (!claim) return;
      await this.process(claim);
    } finally {
      this.running = false;
    }
  }

  private async process(claim: NonNullable<ReturnType<HomeIntelligenceRepository['claimNext']>>): Promise<void> {
    const startedAt = this.now();
    let currentFingerprint: string | undefined;
    try {
      const successfulPatterns = this.repository.getSuccessfulPatterns(this.deps.principal);
      const snapshot = this.deps.snapshot.build({
        now: startedAt,
        locale: this.localeHint,
        successfulPatterns,
      });
      const capabilities = this.deps.capabilities();
      currentFingerprint = generationFingerprint(snapshot.hash, capabilities);
      const previousHash = this.repository.getLatestSnapshotHash(this.deps.principal);
      let generation: HomeModelGeneration | undefined;
      const startOfDay = new Date(startedAt);
      startOfDay.setHours(0, 0, 0, 0);
      const modelGenerationAttempts = this.repository.countModelGenerationAttemptsSince(
        this.deps.principal,
        startOfDay.getTime(),
        claim.generationId,
      );
      const manualRefresh = claim.reasons.includes('manual_refresh');
      const result = modelGenerationAttempts >= DAILY_MODEL_GENERATION_BUDGET && !manualRefresh
        ? { state: 'quiet' as const, reason: 'budget_exhausted' as const }
        : previousHash === currentFingerprint && !manualRefresh
          ? { state: 'quiet' as const, reason: 'no_change' as const }
          : await (async () => {
            generation = await this.deps.generator.generate(snapshot, capabilities, this.abortController.signal);
            return new HomeAdvicePolicy(
              (requirements, options) => this.resolveCapabilityRequirements(
                requirements,
                Boolean(options?.degradedActionAvailable),
              ),
              this.repository.listSuppressionKeys(this.deps.principal),
              new Map(successfulPatterns.map((item) => [
                homePatternKey(item.projectId, item.outcome),
                item.successCount,
              ])),
              this.repository.getPersonalization(this.deps.principal, this.now()),
            ).apply(snapshot, generation.result, this.now());
          })();
      const completedAt = this.now();
      const completion = this.repository.complete(claim, {
        result,
        snapshotHash: currentFingerprint,
        evidenceIds: snapshot.evidence.map((item) => item.id),
        modelRef: generation?.modelRef,
        inputTokens: generation?.usage.inputTokens,
        outputTokens: generation?.usage.outputTokens,
        estimatedCostUsd: generation?.usage.estimatedCostUsd,
        outcomeReason: result.state === 'quiet' ? result.reason : result.state,
        completedAt,
      });
      this.deps.publish('home.advisor.updated', { state: result.state, completedAt });
      if (result.state === 'ready') {
        const notification = buildHomeOpportunityNotification(
          result.opportunities[0]!,
          claim.reasons,
          result.placement ?? 'primary',
        );
        if (notification) this.deps.notifyOpportunity(notification);
      }
      if (completion.dirty) this.requestRefresh('conversation_changed', `dirty:${claim.generationId}:${completedAt}`);
    } catch (error) {
      if (this.stopped) {
        this.repository.fail(claim, this.now(), 'cancelled', this.now());
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/no api key|no default model|credentials|unknown model|local model/i.test(message)) {
        const completedAt = this.now();
        const completion = this.repository.complete(claim, {
          result: { state: 'quiet', reason: 'model_unavailable' },
          snapshotHash: currentFingerprint ?? this.repository.getLatestSnapshotHash(this.deps.principal) ?? 'unavailable',
          evidenceIds: [],
          outcomeReason: 'model_unavailable',
          completedAt,
        });
        this.deps.publish('home.advisor.updated', { state: 'quiet', reason: 'model_unavailable' });
        if (completion.dirty) {
          this.requestRefresh('conversation_changed', `dirty:${claim.generationId}:${completedAt}`);
        }
        return;
      }
      const retryAt = this.now() + (claim.attempt <= 1 ? 60_000 : 5 * 60_000);
      this.repository.fail(claim, this.now(), 'generation_failed', retryAt);
      log.warn({ err: error, generationId: claim.generationId, attempt: claim.attempt }, `Home advice generation failed: ${message}`);
    }
  }

  private resolveCapabilityRequirements(
    requirements: readonly HomeCapabilityRequirement[],
    degradedActionAvailable: boolean,
  ): HomeCapabilityResolution {
    return this.deps.resolveCapabilities(requirements, { degradedActionAvailable });
  }
}
