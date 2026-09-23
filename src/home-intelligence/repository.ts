import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  HomeAdvisorSchema,
  HomeOpportunitySchema,
  type HomeAdvisor,
  type HomeAdviceMetrics,
  type HomeOpportunity,
} from '@xopcai/gateway-contract';

import { runSqliteSavepoint } from '../storage/sqlite/transaction.js';
import type { HomeGeneratedResult } from './types.js';
import {
  HOME_ADVICE_STRATEGY_VERSION,
  HOME_FEEDBACK_WINDOW_MS,
  HOME_NEGATIVE_FEEDBACK_THRESHOLD,
  type HomeAdvicePersonalization,
  type HomeSuccessfulPattern,
  homePatternKey,
} from './strategy.js';

export interface HomePrincipal {
  ownerId: string;
  workspaceId: string;
}

export type HomeGenerationReason =
  | 'home_opened'
  | 'manual_refresh'
  | 'project_changed'
  | 'task_changed'
  | 'conversation_changed'
  | 'connector_changed'
  | 'scheduled_refresh';

export interface HomeGenerationClaim extends HomePrincipal {
  generationId: string;
  leaseOwner: string;
  leaseEpoch: number;
  attempt: number;
  reasons: HomeGenerationReason[];
}

export interface HomeGenerationCompletion {
  result: HomeGeneratedResult;
  snapshotHash: string;
  evidenceIds: string[];
  modelRef?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  outcomeReason?: string;
  completedAt: number;
}

export type HomeFeedbackKind =
  | 'started'
  | 'discussed'
  | 'already_done'
  | 'irrelevant'
  | 'too_early'
  | 'source_incorrect'
  | 'less_like_this'
  | 'snoozed';

export interface HomeOpportunityFeedbackInput {
  feedbackId?: string;
  idempotencyKey: string;
  kind: HomeFeedbackKind;
  expectedRevision: number;
  createdAt: number;
  reasonCode?: string;
  note?: string;
  scope?: Record<string, unknown>;
  snoozedUntil?: number;
  resolution?: { kind: 'session' | 'task' | 'scene'; ref: string };
}

interface GenerationRow {
  generation_id: string;
  owner_id: string;
  workspace_id: string;
  status: string;
  reasons_json: string;
  requested_at: number;
  lease_owner: string | null;
  lease_epoch: number;
  attempt: number;
  dirty_after_start: number;
  result_json: string | null;
  completed_at: number | null;
}

interface OpportunityRow {
  opportunity_id: string;
  generation_id: string;
  content_json: string;
  revision: number;
  state: string;
  expires_at: number;
  snoozed_until: number | null;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function uniqueReasons(reasons: HomeGenerationReason[]): HomeGenerationReason[] {
  return [...new Set(reasons)];
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function parseOpportunity(row: OpportunityRow): HomeOpportunity {
  return HomeOpportunitySchema.parse({
    ...parseJson<Record<string, unknown>>(row.content_json, {}),
    id: row.opportunity_id,
    revision: row.revision,
  });
}

export class HomeIntelligenceRepository {
  constructor(private readonly db: DatabaseSync) {}

  enqueue(
    principal: HomePrincipal,
    input: { idempotencyKey: string; reasons: HomeGenerationReason[]; requestedAt: number },
  ): { generationId: string; created: boolean } {
    return runSqliteSavepoint(this.db, () => {
      const duplicate = this.db.prepare(`SELECT generation_id FROM home_advice_generations
        WHERE owner_id = ? AND workspace_id = ? AND idempotency_key = ?`).get(
        principal.ownerId, principal.workspaceId, input.idempotencyKey,
      ) as { generation_id: string } | undefined;
      if (duplicate) return { generationId: duplicate.generation_id, created: false };

      const active = this.db.prepare(`SELECT * FROM home_advice_generations
        WHERE owner_id = ? AND workspace_id = ?
          AND status IN ('queued', 'running', 'retry_wait')
        LIMIT 1`).get(principal.ownerId, principal.workspaceId) as unknown as GenerationRow | undefined;
      if (active) {
        const reasons = uniqueReasons([
          ...parseJson<HomeGenerationReason[]>(active.reasons_json, []),
          ...input.reasons,
        ]);
        this.db.prepare(`UPDATE home_advice_generations SET
          reasons_json = ?, requested_at = MAX(requested_at, ?),
          dirty_after_start = CASE WHEN status = 'running' THEN 1 ELSE dirty_after_start END
          WHERE generation_id = ?`).run(JSON.stringify(reasons), input.requestedAt, active.generation_id);
        return { generationId: active.generation_id, created: false };
      }

      const generationId = randomUUID();
      this.db.prepare(`INSERT INTO home_advice_generations (
        generation_id, owner_id, workspace_id, idempotency_key, status, reasons_json, requested_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, ?)`).run(
        generationId,
        principal.ownerId,
        principal.workspaceId,
        input.idempotencyKey,
        JSON.stringify(uniqueReasons(input.reasons)),
        input.requestedAt,
      );
      return { generationId, created: true };
    });
  }

  claimNext(principal: HomePrincipal, workerId: string, now: number, leaseMs = 60_000): HomeGenerationClaim | undefined {
    return runSqliteSavepoint(this.db, () => {
      const row = this.db.prepare(`SELECT * FROM home_advice_generations
        WHERE owner_id = ? AND workspace_id = ?
          AND (status = 'queued' OR (status = 'retry_wait' AND retry_at <= ?)
          OR (status = 'running' AND lease_until < ?))
        ORDER BY requested_at ASC LIMIT 1`).get(
        principal.ownerId, principal.workspaceId, now, now,
      ) as unknown as GenerationRow | undefined;
      if (!row) return undefined;

      const nextEpoch = row.lease_epoch + 1;
      const changed = this.db.prepare(`UPDATE home_advice_generations SET
        status = 'running', started_at = ?, lease_owner = ?, lease_until = ?,
        lease_epoch = ?, attempt = attempt + 1, dirty_after_start = 0, retry_at = NULL
        WHERE generation_id = ? AND owner_id = ? AND workspace_id = ? AND lease_epoch = ?
          AND (status = 'queued' OR (status = 'retry_wait' AND retry_at <= ?)
            OR (status = 'running' AND lease_until < ?))`).run(
        now, workerId, now + leaseMs, nextEpoch, row.generation_id,
        principal.ownerId, principal.workspaceId, row.lease_epoch, now, now,
      );
      if (Number(changed.changes) !== 1) return undefined;
      return {
        generationId: row.generation_id,
        ownerId: row.owner_id,
        workspaceId: row.workspace_id,
        leaseOwner: workerId,
        leaseEpoch: nextEpoch,
        attempt: row.attempt + 1,
        reasons: parseJson<HomeGenerationReason[]>(row.reasons_json, []),
      };
    });
  }

  complete(claim: HomeGenerationClaim, completion: HomeGenerationCompletion): { dirty: boolean } {
    return runSqliteSavepoint(this.db, () => {
      const current = this.requireClaim(claim);
      const opportunities: HomeOpportunity[] = [];
      if (completion.result.state === 'ready') {
        const seen = new Set<string>();
        for (const candidate of completion.result.opportunities) {
          const opportunity = HomeOpportunitySchema.parse(candidate);
          const key = this.opportunityDedupeKey(opportunity);
          if (seen.has(key)) continue;
          seen.add(key);
          opportunities.push(opportunity);
          if (opportunities.length === 3) break;
        }
        if (opportunities.length === 0) throw new Error('A ready home generation requires an opportunity');
      }
      const replacesVisible = completion.result.state !== 'quiet' || completion.result.reason === 'insufficient_value';
      if (replacesVisible) {
        this.db.prepare(`UPDATE home_opportunity_projections SET state = 'superseded', updated_at = ?
          WHERE owner_id = ? AND workspace_id = ? AND state IN ('active', 'snoozed')`).run(
          completion.completedAt, claim.ownerId, claim.workspaceId,
        );
      }

      const parsedResult = completion.result.state === 'ready'
        ? {
            state: 'ready' as const,
            placement: completion.result.placement ?? 'primary',
            opportunityIds: opportunities.map((item) => item.id),
          }
        : HomeAdvisorSchema.parse(completion.result);

      if (completion.result.state === 'ready') {
        opportunities.forEach((opportunity, rank) => {
          this.db.prepare(`INSERT INTO home_opportunity_projections (
            opportunity_id, generation_id, owner_id, workspace_id, rank, kind, project_id,
            dedupe_key, content_json, evidence_refs_json, snapshot_hash, state, revision,
            created_at, updated_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
            .run(
              opportunity.id,
              claim.generationId,
              claim.ownerId,
              claim.workspaceId,
              rank,
              opportunity.kind,
              opportunity.projectId ?? null,
              this.opportunityDedupeKey(opportunity),
              JSON.stringify(opportunity),
              JSON.stringify(opportunity.evidence.map(({ id, revision, sourceRef, freshUntil }) => ({ id, revision, sourceRef, freshUntil }))),
              completion.snapshotHash,
              opportunity.revision,
              completion.completedAt,
              completion.completedAt,
              opportunity.expiresAt,
            );
        });
      }

      const status = completion.result.state === 'quiet' ? 'skipped' : 'succeeded';
      const changed = this.db.prepare(`UPDATE home_advice_generations SET
        status = ?, completed_at = ?, lease_owner = NULL, lease_until = NULL,
        snapshot_hash = ?, evidence_ids_json = ?, result_json = ?, model_ref = ?,
        input_tokens = ?, output_tokens = ?, estimated_cost_usd = ?, outcome_reason = ?,
        strategy_version = ?, error_code = NULL
        WHERE generation_id = ? AND status = 'running' AND lease_owner = ? AND lease_epoch = ?`).run(
        status,
        completion.completedAt,
        completion.snapshotHash,
        JSON.stringify([...new Set(completion.evidenceIds)]),
        JSON.stringify(parsedResult),
        completion.modelRef ?? null,
        completion.inputTokens ?? null,
        completion.outputTokens ?? null,
        completion.estimatedCostUsd ?? null,
        completion.outcomeReason ?? null,
        HOME_ADVICE_STRATEGY_VERSION,
        claim.generationId,
        claim.leaseOwner,
        claim.leaseEpoch,
      );
      if (Number(changed.changes) !== 1) throw new Error('Home generation lease was lost');
      return { dirty: current.dirty_after_start === 1 };
    });
  }

  fail(claim: HomeGenerationClaim, now: number, errorCode: string, retryAt?: number): void {
    const status = claim.attempt < 3 && retryAt !== undefined ? 'retry_wait' : 'failed';
    const changed = this.db.prepare(`UPDATE home_advice_generations SET
      status = ?, retry_at = ?, completed_at = CASE WHEN ? = 'failed' THEN ? ELSE NULL END,
      lease_owner = NULL, lease_until = NULL, error_code = ?
      WHERE generation_id = ? AND status = 'running' AND lease_owner = ? AND lease_epoch = ?`).run(
      status, status === 'retry_wait' ? retryAt : null, status, now, errorCode,
      claim.generationId, claim.leaseOwner, claim.leaseEpoch,
    );
    if (Number(changed.changes) !== 1) throw new Error('Home generation lease was lost');
  }

  getLatestSnapshotHash(principal: HomePrincipal): string | undefined {
    const row = this.db.prepare(`SELECT snapshot_hash FROM home_advice_generations
      WHERE owner_id = ? AND workspace_id = ? AND status IN ('succeeded', 'skipped')
      ORDER BY completed_at DESC, rowid DESC LIMIT 1`).get(
      principal.ownerId, principal.workspaceId,
    ) as { snapshot_hash: string | null } | undefined;
    return row?.snapshot_hash ?? undefined;
  }

  countGenerationAttemptsSince(principal: HomePrincipal, since: number): number {
    const row = this.db.prepare(`SELECT COALESCE(SUM(attempt), 0) AS count
      FROM home_advice_generations
      WHERE owner_id = ? AND workspace_id = ? AND COALESCE(started_at, requested_at) >= ?`).get(
      principal.ownerId, principal.workspaceId, since,
    ) as { count: number };
    return Number(row.count);
  }

  listSuppressionKeys(principal: HomePrincipal): Set<string> {
    const rows = this.db.prepare(`SELECT f.scope_json, p.kind, p.project_id
      FROM home_opportunity_feedback f
      JOIN home_opportunity_projections p ON p.opportunity_id = f.opportunity_id
      WHERE p.owner_id = ? AND p.workspace_id = ? AND f.kind = 'less_like_this'
      ORDER BY f.created_at DESC LIMIT 100`).all(principal.ownerId, principal.workspaceId) as Array<{
        scope_json: string;
        kind: string;
        project_id: string | null;
      }>;
    return new Set(rows.map((row) => {
      const scope = parseJson<{ kind?: unknown; projectId?: unknown }>(row.scope_json, {});
      const kind = typeof scope.kind === 'string' ? scope.kind : row.kind;
      const projectId = typeof scope.projectId === 'string' ? scope.projectId : row.project_id;
      return `${kind}:${projectId ?? 'global'}`;
    }));
  }

  getSuccessfulPatterns(principal: HomePrincipal): HomeSuccessfulPattern[] {
    const rows = this.db.prepare(`SELECT p.content_json
      FROM home_opportunity_projections p
      JOIN tasks t ON p.resolution_kind = 'task' AND p.resolution_ref = t.task_id
      WHERE p.owner_id = ? AND p.workspace_id = ?
        AND p.state = 'accepted' AND t.phase = 'closed' AND t.resolution = 'done'`).all(
      principal.ownerId, principal.workspaceId,
    ) as Array<{ content_json: string }>;
    const patterns = new Map<string, HomeSuccessfulPattern>();
    for (const row of rows) {
      const opportunity = HomeOpportunitySchema.parse(parseJson<unknown>(row.content_json, null));
      const key = homePatternKey(opportunity.projectId, opportunity.outcome);
      const current = patterns.get(key);
      patterns.set(key, {
        projectId: opportunity.projectId,
        title: opportunity.title,
        outcome: opportunity.outcome,
        successCount: (current?.successCount ?? 0) + 1,
      });
    }
    return [...patterns.values()].sort((left, right) => right.successCount - left.successCount
      || left.outcome.localeCompare(right.outcome));
  }

  getPersonalization(principal: HomePrincipal, now: number): HomeAdvicePersonalization {
    const rows = this.db.prepare(`SELECT p.kind,
        SUM(CASE WHEN f.kind IN ('irrelevant', 'source_incorrect') THEN 1 ELSE 0 END) AS negative_count,
        SUM(CASE WHEN f.kind = 'started' THEN 1 ELSE 0 END) AS positive_count
      FROM home_opportunity_feedback f
      JOIN home_opportunity_projections p ON p.opportunity_id = f.opportunity_id
      WHERE p.owner_id = ? AND p.workspace_id = ? AND f.created_at >= ?
      GROUP BY p.kind`).all(
      principal.ownerId,
      principal.workspaceId,
      now - HOME_FEEDBACK_WINDOW_MS,
    ) as Array<{ kind: HomeOpportunity['kind']; negative_count: number; positive_count: number }>;
    return {
      highConfidenceKinds: new Set(rows
        .filter((row) => Number(row.negative_count) >= HOME_NEGATIVE_FEEDBACK_THRESHOLD
          && Number(row.negative_count) - Number(row.positive_count) >= 2)
        .map((row) => row.kind)),
    };
  }

  getMetrics(principal: HomePrincipal, since: number, until: number): HomeAdviceMetrics {
    const generation = this.db.prepare(`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS ready,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS quiet,
        SUM(CASE WHEN status IN ('failed', 'cancelled') THEN 1 ELSE 0 END) AS failed,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
      FROM home_advice_generations
      WHERE owner_id = ? AND workspace_id = ? AND requested_at BETWEEN ? AND ?`).get(
      principal.ownerId, principal.workspaceId, since, until,
    ) as { total: number; ready: number; quiet: number; failed: number; estimated_cost_usd: number };
    const outcome = this.db.prepare(`SELECT
        COUNT(*) AS opportunities,
        SUM(CASE WHEN state = 'accepted' THEN 1 ELSE 0 END) AS started,
        SUM(CASE WHEN state = 'discussing' THEN 1 ELSE 0 END) AS discussed,
        SUM(CASE WHEN state = 'expired' THEN 1 ELSE 0 END) AS expired
      FROM home_opportunity_projections
      WHERE owner_id = ? AND workspace_id = ? AND created_at BETWEEN ? AND ?`).get(
      principal.ownerId, principal.workspaceId, since, until,
    ) as { opportunities: number; started: number; discussed: number; expired: number };
    const completed = this.db.prepare(`SELECT COUNT(*) AS count
      FROM home_opportunity_projections p
      JOIN tasks t ON p.resolution_kind = 'task' AND p.resolution_ref = t.task_id
      WHERE p.owner_id = ? AND p.workspace_id = ? AND p.created_at BETWEEN ? AND ?
        AND t.phase = 'closed' AND t.resolution = 'done'`).get(
      principal.ownerId, principal.workspaceId, since, until,
    ) as { count: number };
    const feedbackRows = this.db.prepare(`SELECT f.kind, COUNT(*) AS count
      FROM home_opportunity_feedback f
      JOIN home_opportunity_projections p ON p.opportunity_id = f.opportunity_id
      WHERE p.owner_id = ? AND p.workspace_id = ? AND f.created_at BETWEEN ? AND ?
      GROUP BY f.kind`).all(
      principal.ownerId, principal.workspaceId, since, until,
    ) as Array<{ kind: HomeFeedbackKind; count: number }>;
    const feedback = new Map(feedbackRows.map((row) => [row.kind, Number(row.count)]));
    const corrected = ['already_done', 'irrelevant', 'too_early', 'source_incorrect', 'less_like_this']
      .reduce((count, kind) => count + (feedback.get(kind as HomeFeedbackKind) ?? 0), 0);
    const strategyRows = this.db.prepare(`SELECT
        g.strategy_version AS version,
        COUNT(DISTINCT g.generation_id) AS generations,
        COUNT(DISTINCT p.opportunity_id) AS opportunities,
        COUNT(DISTINCT CASE WHEN f.kind = 'started' THEN p.opportunity_id END) AS started,
        COUNT(DISTINCT CASE WHEN t.phase = 'closed' AND t.resolution = 'done' THEN p.opportunity_id END) AS completed
      FROM home_advice_generations g
      LEFT JOIN home_opportunity_projections p ON p.generation_id = g.generation_id
      LEFT JOIN home_opportunity_feedback f ON f.opportunity_id = p.opportunity_id
      LEFT JOIN tasks t ON p.resolution_kind = 'task' AND p.resolution_ref = t.task_id
      WHERE g.owner_id = ? AND g.workspace_id = ? AND g.requested_at BETWEEN ? AND ?
      GROUP BY g.strategy_version
      ORDER BY g.strategy_version`).all(
      principal.ownerId, principal.workspaceId, since, until,
    ) as Array<{ version: string; generations: number; opportunities: number; started: number; completed: number }>;
    const opportunities = Number(outcome.opportunities);
    const started = Number(outcome.started);
    return {
      window: { since, until },
      currentStrategyVersion: HOME_ADVICE_STRATEGY_VERSION,
      generations: {
        total: Number(generation.total), ready: Number(generation.ready), quiet: Number(generation.quiet),
        failed: Number(generation.failed), estimatedCostUsd: Number(generation.estimated_cost_usd),
      },
      outcomes: {
        opportunities,
        started,
        discussed: Number(outcome.discussed),
        completed: Number(completed.count),
        corrected,
        expired: Number(outcome.expired),
      },
      rates: {
        start: ratio(started, opportunities),
        completionFromStarted: ratio(Number(completed.count), started),
        correction: ratio(corrected, opportunities),
      },
      feedback: {
        alreadyDone: feedback.get('already_done') ?? 0,
        irrelevant: feedback.get('irrelevant') ?? 0,
        tooEarly: feedback.get('too_early') ?? 0,
        sourceIncorrect: feedback.get('source_incorrect') ?? 0,
        lessLikeThis: feedback.get('less_like_this') ?? 0,
      },
      strategies: strategyRows.map((row) => ({
        version: row.version,
        generations: Number(row.generations),
        opportunities: Number(row.opportunities),
        started: Number(row.started),
        completed: Number(row.completed),
      })),
    };
  }

  invalidateOpportunitiesByEvidenceSources(
    principal: HomePrincipal,
    sourceTypes: ReadonlySet<HomeOpportunity['evidence'][number]['sourceType']>,
    now: number,
  ): number {
    if (!sourceTypes.size) return 0;
    return runSqliteSavepoint(this.db, () => {
      const rows = this.db.prepare(`SELECT opportunity_id, generation_id, content_json, revision, state, expires_at, snoozed_until
        FROM home_opportunity_projections
        WHERE owner_id = ? AND workspace_id = ? AND state IN ('active', 'snoozed')`).all(
        principal.ownerId, principal.workspaceId,
      ) as unknown as OpportunityRow[];
      const ids = rows
        .filter((row) => parseOpportunity(row).evidence.some((item) => sourceTypes.has(item.sourceType)))
        .map((row) => row.opportunity_id);
      const invalidate = this.db.prepare(`UPDATE home_opportunity_projections
        SET state = 'superseded', revision = revision + 1, updated_at = ?
        WHERE opportunity_id = ? AND owner_id = ? AND workspace_id = ? AND state IN ('active', 'snoozed')`);
      return ids.reduce((count, id) => count + Number(invalidate.run(
        now, id, principal.ownerId, principal.workspaceId,
      ).changes), 0);
    });
  }

  getAdvisor(principal: HomePrincipal, now: number): HomeAdvisor {
    const active = this.db.prepare(`SELECT requested_at FROM home_advice_generations
      WHERE owner_id = ? AND workspace_id = ? AND status IN ('queued', 'running', 'retry_wait')
      ORDER BY requested_at DESC LIMIT 1`).get(principal.ownerId, principal.workspaceId) as { requested_at: number } | undefined;
    const rows = this.db.prepare(`SELECT opportunity_id, generation_id, content_json, revision, state, expires_at, snoozed_until
      FROM home_opportunity_projections
      WHERE owner_id = ? AND workspace_id = ? AND state IN ('active', 'snoozed')
        AND expires_at > ? AND (state = 'active' OR snoozed_until <= ?)
      ORDER BY rank ASC LIMIT 3`).all(principal.ownerId, principal.workspaceId, now, now) as unknown as OpportunityRow[];
    const opportunities = rows.map(parseOpportunity);
    if (opportunities.length > 0) {
      const generatedAt = Math.min(...opportunities.map((item) => item.generatedAt));
      const expiresAt = Math.min(...opportunities.map((item) => item.expiresAt));
      const generation = this.db.prepare(`SELECT result_json FROM home_advice_generations
        WHERE generation_id = ?`).get(rows[0]!.generation_id) as { result_json: string | null } | undefined;
      const result = generation?.result_json ? parseJson<{ placement?: unknown }>(generation.result_json, {}) : {};
      const placement = result.placement === 'compact' ? 'compact' : 'primary';
      return HomeAdvisorSchema.parse({
        state: 'ready',
        primary: opportunities[0],
        alternatives: opportunities.slice(1),
        placement,
        generatedAt,
        expiresAt,
        stale: Boolean(active),
      });
    }
    if (active) return { state: 'refreshing', requestedAt: active.requested_at };

    const latest = this.db.prepare(`SELECT result_json FROM home_advice_generations
      WHERE owner_id = ? AND workspace_id = ? AND status IN ('succeeded', 'skipped')
      ORDER BY completed_at DESC, rowid DESC LIMIT 1`).get(
      principal.ownerId, principal.workspaceId,
    ) as { result_json: string | null } | undefined;
    const result = latest?.result_json ? parseJson<unknown>(latest.result_json, null) : null;
    if (result && typeof result === 'object' && 'state' in result && (result.state === 'quiet' || result.state === 'clarification')) {
      const advisor = HomeAdvisorSchema.parse(result);
      return advisor.state === 'clarification' && advisor.expiresAt <= now
        ? { state: 'quiet', reason: 'no_change' }
        : advisor;
    }
    return { state: 'quiet', reason: 'no_change' };
  }

  getOpportunity(principal: HomePrincipal, opportunityId: string, now: number): HomeOpportunity | undefined {
    const row = this.db.prepare(`SELECT opportunity_id, generation_id, content_json, revision, state, expires_at, snoozed_until
      FROM home_opportunity_projections WHERE opportunity_id = ? AND owner_id = ? AND workspace_id = ?
        AND state IN ('active', 'snoozed') AND expires_at > ?`).get(
      opportunityId, principal.ownerId, principal.workspaceId, now,
    ) as unknown as OpportunityRow | undefined;
    return row ? parseOpportunity(row) : undefined;
  }

  getOpportunitySnapshot(principal: HomePrincipal, opportunityId: string): HomeOpportunity | undefined {
    const row = this.db.prepare(`SELECT opportunity_id, generation_id, content_json, revision, state, expires_at, snoozed_until
      FROM home_opportunity_projections WHERE opportunity_id = ? AND owner_id = ? AND workspace_id = ?`).get(
      opportunityId, principal.ownerId, principal.workspaceId,
    ) as unknown as OpportunityRow | undefined;
    return row ? parseOpportunity(row) : undefined;
  }

  isFeedbackRecorded(opportunityId: string, idempotencyKey: string): boolean {
    const row = this.db.prepare(`SELECT opportunity_id FROM home_opportunity_feedback
      WHERE idempotency_key = ?`).get(idempotencyKey) as { opportunity_id: string } | undefined;
    if (!row) return false;
    if (row.opportunity_id !== opportunityId) throw new Error('Feedback idempotency key belongs to another opportunity');
    return true;
  }

  recordFeedback(
    principal: HomePrincipal,
    opportunityId: string,
    input: HomeOpportunityFeedbackInput,
  ): HomeOpportunity | undefined {
    return runSqliteSavepoint(this.db, () => {
      const duplicate = this.db.prepare(`SELECT opportunity_id FROM home_opportunity_feedback
        WHERE idempotency_key = ?`).get(input.idempotencyKey) as { opportunity_id: string } | undefined;
      if (duplicate) {
        if (duplicate.opportunity_id !== opportunityId) throw new Error('Feedback idempotency key belongs to another opportunity');
        return this.getOpportunity(principal, opportunityId, input.createdAt);
      }

      const next = this.feedbackTransition(input);
      const changed = this.db.prepare(`UPDATE home_opportunity_projections SET
        state = ?, revision = revision + 1, updated_at = ?, snoozed_until = ?,
        resolution_kind = ?, resolution_ref = ?
        WHERE opportunity_id = ? AND owner_id = ? AND workspace_id = ?
          AND revision = ? AND state IN ('active', 'snoozed')`).run(
        next.state,
        input.createdAt,
        next.snoozedUntil,
        input.resolution?.kind ?? null,
        input.resolution?.ref ?? null,
        opportunityId,
        principal.ownerId,
        principal.workspaceId,
        input.expectedRevision,
      );
      if (Number(changed.changes) !== 1) throw new Error('Home opportunity is stale or unavailable');
      this.db.prepare(`INSERT INTO home_opportunity_feedback (
        feedback_id, opportunity_id, idempotency_key, kind, reason_code, note, scope_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.feedbackId ?? randomUUID(),
        opportunityId,
        input.idempotencyKey,
        input.kind,
        input.reasonCode ?? null,
        input.note ?? null,
        JSON.stringify(input.scope ?? {}),
        input.createdAt,
      );
      return this.getOpportunity(principal, opportunityId, input.createdAt);
    });
  }

  maintain(now: number): { expired: number; awakened: number } {
    return runSqliteSavepoint(this.db, () => {
      const expired = this.db.prepare(`UPDATE home_opportunity_projections
        SET state = 'expired', revision = revision + 1, updated_at = ?
        WHERE state IN ('active', 'snoozed') AND expires_at <= ?`).run(now, now);
      const awakened = this.db.prepare(`UPDATE home_opportunity_projections
        SET state = 'active', revision = revision + 1, updated_at = ?, snoozed_until = NULL
        WHERE state = 'snoozed' AND snoozed_until <= ? AND expires_at > ?`).run(now, now, now);
      return { expired: Number(expired.changes), awakened: Number(awakened.changes) };
    });
  }

  private requireClaim(claim: HomeGenerationClaim): GenerationRow {
    const row = this.db.prepare(`SELECT * FROM home_advice_generations
      WHERE generation_id = ? AND status = 'running' AND lease_owner = ? AND lease_epoch = ?`).get(
      claim.generationId, claim.leaseOwner, claim.leaseEpoch,
    ) as unknown as GenerationRow | undefined;
    if (!row) throw new Error('Home generation lease was lost');
    return row;
  }

  private feedbackTransition(input: HomeOpportunityFeedbackInput): { state: string; snoozedUntil: number | null } {
    if (input.kind === 'started') return { state: 'accepted', snoozedUntil: null };
    if (input.kind === 'discussed') return { state: 'discussing', snoozedUntil: null };
    if (input.kind === 'snoozed' || input.kind === 'too_early') {
      if (!input.snoozedUntil || input.snoozedUntil <= input.createdAt) {
        throw new Error('A future snoozedUntil is required');
      }
      return { state: 'snoozed', snoozedUntil: input.snoozedUntil };
    }
    return { state: 'dismissed', snoozedUntil: null };
  }

  private opportunityDedupeKey(opportunity: HomeOpportunity): string {
    const outcome = opportunity.outcome.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
    return `${opportunity.kind}:${opportunity.projectId ?? 'global'}:${outcome}`;
  }
}
