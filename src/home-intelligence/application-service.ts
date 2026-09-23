import type { DatabaseSync } from 'node:sqlite';

import type { HomeOpportunityActionResponse } from '@xopcai/gateway-contract';

import { TaskApplicationService } from '../tasks/task-application-service.js';
import { TaskRepository } from '../tasks/task-repository.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import {
  HomeIntelligenceRepository,
  type HomeOpportunityFeedbackInput,
  type HomePrincipal,
} from './repository.js';

export class HomeOpportunityNotFoundError extends Error {}
export class HomeOpportunityActionError extends Error {}

export class HomeOpportunityApplicationService {
  private readonly repository: HomeIntelligenceRepository;
  private readonly tasks = new TaskRepository();
  private readonly taskApplication = new TaskApplicationService();

  constructor(
    private readonly db: DatabaseSync,
    private readonly principal: HomePrincipal,
    private readonly resolveAgentId: () => string = () => 'main',
  ) {
    this.repository = new HomeIntelligenceRepository(db);
  }

  start(input: {
    opportunityId: string;
    expectedRevision: number;
    idempotencyKey: string;
    now: number;
  }, options: { degraded?: boolean } = {}): HomeOpportunityActionResponse {
    return runSqliteWriteTransaction((db) => {
      if (db !== this.db) throw new Error('Home opportunity service database mismatch');
      const taskKey = `home-opportunity:${input.opportunityId}:${input.idempotencyKey}`;
      const existing = this.tasks.getByIdempotencyKey(taskKey);
      if (existing) return {
        outcome: 'task', taskId: existing.id, href: `/tasks/${encodeURIComponent(existing.id)}`,
      };
      const opportunity = this.repository.getOpportunity(this.principal, input.opportunityId, input.now);
      if (!opportunity) throw new HomeOpportunityNotFoundError('Home opportunity is unavailable');
      if (opportunity.revision !== input.expectedRevision) throw new HomeOpportunityActionError('Home opportunity changed; refresh before starting');
      if (opportunity.evidence.some((item) => item.freshUntil <= input.now)) {
        throw new HomeOpportunityActionError('Home opportunity evidence expired; refresh before starting');
      }
      const degraded = Boolean(options.degraded);
      if (degraded && !opportunity.degradedActionPrompt) {
        throw new HomeOpportunityActionError('This opportunity has no degraded start path');
      }
      if ((!degraded && !opportunity.actions.canStart) || opportunity.risk === 'external_write') {
        throw new HomeOpportunityActionError('This opportunity must be discussed before it can start');
      }
      const agentId = this.resolveAgentId();
      const created = this.taskApplication.create({
        idempotencyKey: taskKey,
        title: opportunity.title,
        projectId: opportunity.projectId,
        priority: opportunity.urgency === 'now' ? 'high' : 'normal',
        delegateAgentId: agentId,
        contract: {
          objective: degraded ? opportunity.degradedActionPrompt! : opportunity.actionPrompt,
          expectedOutputs: [opportunity.outcome],
          acceptanceCriteria: opportunity.verification,
          constraints: degraded
            ? ['Use only currently available capabilities and the attached evidence.']
            : [],
          approvalRequired: [], assumptions: [],
          risks: [opportunity.risk],
          acceptancePolicy: 'verified_then_review',
          outputDestinations: [],
        },
        dependencies: [],
        context: opportunity.evidence.map((item) => ({
          targetKind: item.sourceType === 'file' ? 'file' as const : 'source' as const,
          targetId: item.sourceRef,
          role: 'evidence' as const,
          title: item.observation.slice(0, 200),
          pinned: true,
          retrievalPolicy: {},
          metadata: { evidenceId: item.id, revision: item.revision },
        })),
        authorityGrants: [],
        activation: { mode: 'start', executor: { kind: 'agent', agentId } },
      }, { kind: 'user' });
      if (created.ok === false) throw new HomeOpportunityActionError(`Could not start task: ${created.reason}`);
      const task = created.model.task;
      this.repository.recordFeedback(this.principal, input.opportunityId, {
        idempotencyKey: input.idempotencyKey,
        kind: 'started',
        expectedRevision: input.expectedRevision,
        createdAt: input.now,
        resolution: { kind: 'task', ref: task.id },
      });
      return {
        outcome: 'task', taskId: task.id, href: `/tasks/${encodeURIComponent(task.id)}`,
      };
    });
  }

  discuss(input: {
    opportunityId: string;
    expectedRevision: number;
    idempotencyKey: string;
    now: number;
  }): HomeOpportunityActionResponse {
    const replay = this.repository.isFeedbackRecorded(input.opportunityId, input.idempotencyKey);
    const opportunity = replay
      ? this.repository.getOpportunitySnapshot(this.principal, input.opportunityId)
      : this.repository.getOpportunity(this.principal, input.opportunityId, input.now);
    if (!opportunity) throw new HomeOpportunityNotFoundError('Home opportunity is unavailable');
    if (!replay) {
      if (opportunity.revision !== input.expectedRevision) throw new HomeOpportunityActionError('Home opportunity changed; refresh before discussing');
      this.repository.recordFeedback(this.principal, input.opportunityId, {
        idempotencyKey: input.idempotencyKey,
        kind: 'discussed',
        expectedRevision: input.expectedRevision,
        createdAt: input.now,
        resolution: { kind: 'session', ref: 'draft' },
      });
    }
    const query = new URLSearchParams({ draft: opportunity.actionPrompt });
    if (opportunity.projectId) query.set('projectId', opportunity.projectId);
    return { outcome: 'chat_draft', href: `/chat/new?${query.toString()}` };
  }

  feedback(opportunityId: string, input: HomeOpportunityFeedbackInput): void {
    if (this.repository.isFeedbackRecorded(opportunityId, input.idempotencyKey)) return;
    const opportunity = this.repository.getOpportunity(this.principal, opportunityId, input.createdAt);
    if (!opportunity) throw new HomeOpportunityNotFoundError('Home opportunity is unavailable');
    this.repository.recordFeedback(this.principal, opportunityId, {
      ...input,
      scope: input.scope ?? { kind: opportunity.kind, projectId: opportunity.projectId },
    });
  }
}
