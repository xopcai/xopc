import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HomeOpportunity } from '@xopcai/gateway-contract';

import {
  closeXopcDatabase,
  getXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { HomeOpportunityActionError, HomeOpportunityApplicationService } from '../application-service.js';
import { HomeIntelligenceRepository } from '../repository.js';

const principal = { ownerId: 'owner', workspaceId: 'workspace' };

function opportunity(risk: HomeOpportunity['risk'] = 'analysis', id = 'opportunity-1'): HomeOpportunity {
  return {
    id, revision: 1, kind: 'project_next_step', title: '准备发布清单',
    outcome: '形成可执行的发布清单', rationale: '项目即将发布',
    evidence: [{ id: 'project:1', sourceType: 'project', sourceRef: 'project-1', revision: '1', observation: '本周发布', observedAt: 1, freshUntil: 10_000 }],
    confidence: 'high', urgency: 'today', risk, proposedSteps: ['汇总事项'], capabilities: [],
    verification: ['清单包含负责人和状态'], actionPrompt: '整理项目发布清单。',
    actions: { canStart: risk !== 'external_write', canDiscuss: true, degradedStartAvailable: false },
    generatedAt: 1, expiresAt: 10_000,
  };
}

function seed(repository: HomeIntelligenceRepository, item: HomeOpportunity): void {
  repository.enqueue(principal, { idempotencyKey: `generation:${item.id}`, reasons: ['manual_refresh'], requestedAt: 1 });
  repository.complete(repository.claimNext(principal, 'worker', 2)!, {
    result: { state: 'ready', opportunities: [item] }, snapshotHash: 'snapshot', evidenceIds: ['project:1'], completedAt: 3,
  });
}

describe('HomeOpportunityApplicationService', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
  });
  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('atomically turns an executable opportunity into an idempotent task', () => {
    const db = getXopcDatabase().db;
    const repository = new HomeIntelligenceRepository(db);
    seed(repository, opportunity());
    const service = new HomeOpportunityApplicationService(db, principal);
    const first = service.start({ opportunityId: 'opportunity-1', expectedRevision: 1, idempotencyKey: 'start:1', now: 10 });
    const second = service.start({ opportunityId: 'opportunity-1', expectedRevision: 1, idempotencyKey: 'start:1', now: 11 });
    if (first.outcome !== 'task') throw new Error('Expected a task outcome');
    expect(second).toEqual(first);
    expect(new TaskRepository().list()).toHaveLength(1);
    expect(repository.listHistory(principal)).toMatchObject([{
      status: 'started',
      feedbackKind: 'started',
      href: first.href,
    }]);
    expect(repository.getAdvisor(principal, 12)).toEqual({ state: 'quiet', reason: 'no_change' });
  });

  it('counts completed tasks before offering persistent help', () => {
    const db = getXopcDatabase().db;
    const repository = new HomeIntelligenceRepository(db);
    const tasks = new TaskRepository();
    for (const [index, opportunityId] of ['success-1', 'success-2'].entries()) {
      seed(repository, { ...opportunity('analysis', opportunityId), kind: 'automation_candidate' });
      const result = new HomeOpportunityApplicationService(db, principal).start({
        opportunityId, expectedRevision: 1, idempotencyKey: `start:${opportunityId}`, now: 10 + index * 20,
      });
      if (result.outcome !== 'task') throw new Error('Expected a task outcome');
      const task = tasks.get(result.taskId)!;
      tasks.setLifecycle({
        taskId: task.id, expectedVersion: task.version, phase: 'closed', resolution: 'done', now: 20 + index * 20,
      });
    }
    expect(repository.getSuccessfulPatterns(principal)).toEqual([{
      title: '准备发布清单', outcome: '形成可执行的发布清单', successCount: 2,
    }]);
  });

  it('does not create a task for an external-write recommendation', () => {
    const db = getXopcDatabase().db;
    seed(new HomeIntelligenceRepository(db), opportunity('external_write'));
    const service = new HomeOpportunityApplicationService(db, principal);
    expect(() => service.start({ opportunityId: 'opportunity-1', expectedRevision: 1, idempotencyKey: 'start:1', now: 10 }))
      .toThrow(HomeOpportunityActionError);
    expect(new TaskRepository().list()).toEqual([]);
  });

  it('does not create a task from expired evidence', () => {
    const db = getXopcDatabase().db;
    seed(new HomeIntelligenceRepository(db), { ...opportunity(), expiresAt: 20_000 });
    const service = new HomeOpportunityApplicationService(db, principal);
    expect(() => service.start({
      opportunityId: 'opportunity-1', expectedRevision: 1, idempotencyKey: 'start:expired', now: 10_001,
    })).toThrow('evidence expired');
    expect(new TaskRepository().list()).toEqual([]);
  });

  it('starts an explicitly available degraded path without granting the missing capability', () => {
    const db = getXopcDatabase().db;
    const item = {
      ...opportunity(),
      capabilities: [{
        kind: 'connector' as const, capability: 'composio-gmail', required: true,
        readiness: 'needs_setup' as const, recoveryPath: '/connectors', reason: 'Not connected',
      }],
      degradedActionPrompt: '仅使用现有项目证据准备一份待用户确认的跟进草稿。',
      actions: { canStart: false, canDiscuss: true, degradedStartAvailable: true },
    };
    seed(new HomeIntelligenceRepository(db), item);
    const service = new HomeOpportunityApplicationService(db, principal);
    const result = service.start({
      opportunityId: 'opportunity-1', expectedRevision: 1, idempotencyKey: 'start:degraded', now: 10,
    }, { degraded: true });
    expect(result).toMatchObject({ outcome: 'task' });
    expect(new TaskRepository().list()[0]?.contract).toMatchObject({
      objective: '仅使用现有项目证据准备一份待用户确认的跟进草稿。',
      constraints: ['Use only currently available capabilities and the attached evidence.'],
    });
  });

  it('replays discussion and feedback requests safely after the state changes', () => {
    const db = getXopcDatabase().db;
    const repository = new HomeIntelligenceRepository(db);
    seed(repository, opportunity());
    const service = new HomeOpportunityApplicationService(db, principal);
    const request = { opportunityId: 'opportunity-1', expectedRevision: 1, idempotencyKey: 'discuss:1', now: 10 };
    expect(service.discuss(request)).toEqual(service.discuss({ ...request, now: 11 }));

    repository.enqueue(principal, { idempotencyKey: 'generation:2', reasons: ['manual_refresh'], requestedAt: 12 });
    repository.complete(repository.claimNext(principal, 'worker', 13)!, {
      result: { state: 'ready', opportunities: [{ ...opportunity(), id: 'opportunity-2', generatedAt: 12, expiresAt: 20_000 }] },
      snapshotHash: 'snapshot-2', evidenceIds: ['project:1'], completedAt: 14,
    });
    const feedback = { idempotencyKey: 'feedback:1', expectedRevision: 1, kind: 'irrelevant' as const, createdAt: 15 };
    service.feedback('opportunity-2', feedback);
    expect(() => service.feedback('opportunity-2', { ...feedback, createdAt: 16 })).not.toThrow();
  });
});
