import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import type { HomeOpportunity } from '@xopcai/gateway-contract';

import { HomeIntelligenceRepository } from '../repository.js';
import { ensureXopcDatabaseSchema } from '../../storage/sqlite/schema.js';

const principal = { ownerId: 'local-user', workspaceId: 'default' };

function opportunity(id = 'opportunity-1', now = 1_000): HomeOpportunity {
  return {
    id,
    revision: 1,
    kind: 'project_next_step',
    projectId: 'project-1',
    title: '整理 Atlas 发布前的剩余事项',
    outcome: '得到一份可以直接执行的发布清单。',
    rationale: '项目本周需要交付，仍有两个未关闭的工作线程。',
    evidence: [{
      id: 'project:project-1:v2',
      sourceType: 'project',
      sourceRef: 'project-1',
      revision: '2',
      observation: 'Atlas 的目标是本周发布。',
      observedAt: now,
      freshUntil: now + 60_000,
      href: '/projects/project-1',
    }],
    confidence: 'high',
    urgency: 'today',
    estimatedMinutes: 20,
    risk: 'analysis',
    proposedSteps: ['汇总未完成事项', '按阻塞程度排序'],
    capabilities: [{ kind: 'agent', capability: 'reasoning', resolvedId: 'main', readiness: 'ready', required: true }],
    verification: ['清单覆盖所有未完成事项'],
    actionPrompt: '检查 Atlas 项目，整理发布前剩余事项并给出优先级。',
    actions: { canStart: true, canDiscuss: true, degradedStartAvailable: false },
    generatedAt: now,
    expiresAt: now + 60_000,
  };
}

describe('HomeIntelligenceRepository', () => {
  let db: DatabaseSync;
  let repository: HomeIntelligenceRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    ensureXopcDatabaseSchema(db);
    repository = new HomeIntelligenceRepository(db);
  });

  it('coalesces refresh requests and marks a running generation dirty', () => {
    const first = repository.enqueue(principal, {
      idempotencyKey: 'task:1', reasons: ['task_changed'], requestedAt: 1_000,
    });
    const claim = repository.claimNext(principal, 'worker-1', 1_001)!;
    const second = repository.enqueue(principal, {
      idempotencyKey: 'project:2', reasons: ['project_changed'], requestedAt: 1_002,
    });

    expect(second).toEqual({ generationId: first.generationId, created: false });
    expect(repository.complete(claim, {
      result: { state: 'quiet', reason: 'no_change' },
      snapshotHash: 'snapshot-1', evidenceIds: [], completedAt: 1_003,
    })).toEqual({ dirty: true });
  });

  it('deduplicates model output and exposes the latest validated opportunities', () => {
    repository.enqueue(principal, {
      idempotencyKey: 'manual:1', reasons: ['manual_refresh'], requestedAt: 1_000,
    });
    const claim = repository.claimNext(principal, 'worker-1', 1_001)!;
    repository.complete(claim, {
      result: {
        state: 'ready',
        opportunities: [
          opportunity('one'),
          { ...opportunity('duplicate'), title: ' 整理 Atlas 发布前的剩余事项 ' },
          { ...opportunity('two'), title: '准备 Atlas 发布公告', outcome: '得到一份发布公告。' },
          { ...opportunity('three'), title: '检查 Atlas 发布指标', outcome: '得到一份发布指标检查结果。' },
        ],
      },
      snapshotHash: 'snapshot-1', evidenceIds: ['project:project-1:v2'], completedAt: 1_002,
    });

    expect(repository.getAdvisor(principal, 1_003)).toMatchObject({
      state: 'ready',
      primary: { id: 'one', revision: 1 },
      alternatives: [{ id: 'two' }, { id: 'three' }],
      stale: false,
    });
    expect(repository.getLatestSnapshotHash(principal)).toBe('snapshot-1');
  });

  it('does not let cache and budget skips replace the last evaluated snapshot', () => {
    repository.enqueue(principal, {
      idempotencyKey: 'model:1', reasons: ['manual_refresh'], requestedAt: 1_000,
    });
    repository.complete(repository.claimNext(principal, 'worker', 1_001)!, {
      result: { state: 'quiet', reason: 'no_change' },
      snapshotHash: 'evaluated', evidenceIds: [], modelRef: 'test/reasoning',
      outcomeReason: 'no_change', completedAt: 1_002,
    });
    for (const [index, reason] of (['no_change', 'budget_exhausted'] as const).entries()) {
      repository.enqueue(principal, {
        idempotencyKey: `skip:${index}`, reasons: ['task_changed'], requestedAt: 1_003 + index,
      });
      repository.complete(repository.claimNext(principal, 'worker', 1_003 + index)!, {
        result: { state: 'quiet', reason }, snapshotHash: `skip-${index}`, evidenceIds: [],
        outcomeReason: reason, completedAt: 1_003 + index,
      });
    }

    expect(repository.getLatestSnapshotHash(principal)).toBe('evaluated');
  });

  it('counts only model generation attempts and excludes the current claim', () => {
    repository.enqueue(principal, {
      idempotencyKey: 'model:1', reasons: ['manual_refresh'], requestedAt: 1_000,
    });
    repository.complete(repository.claimNext(principal, 'worker', 1_001)!, {
      result: { state: 'quiet', reason: 'insufficient_value' },
      snapshotHash: 'model', evidenceIds: [], modelRef: 'test/reasoning', completedAt: 1_002,
    });
    repository.enqueue(principal, {
      idempotencyKey: 'skip:1', reasons: ['task_changed'], requestedAt: 1_003,
    });
    repository.complete(repository.claimNext(principal, 'worker', 1_004)!, {
      result: { state: 'quiet', reason: 'no_change' },
      snapshotHash: 'skip', evidenceIds: [], completedAt: 1_005,
    });
    repository.enqueue(principal, {
      idempotencyKey: 'current:1', reasons: ['task_changed'], requestedAt: 1_006,
    });
    const current = repository.claimNext(principal, 'worker', 1_007)!;

    expect(repository.countModelGenerationAttemptsSince(principal, 0, current.generationId)).toBe(1);
  });

  it('exposes a terminal generation failure instead of silently returning no change', () => {
    repository.enqueue(principal, {
      idempotencyKey: 'failed:1', reasons: ['manual_refresh'], requestedAt: 1_000,
    });
    const first = repository.claimNext(principal, 'worker', 1_001)!;
    repository.fail(first, 1_002, 'generation_failed', 1_003);
    const second = repository.claimNext(principal, 'worker', 1_003)!;
    repository.fail(second, 1_004, 'generation_failed', 1_005);
    const third = repository.claimNext(principal, 'worker', 1_005)!;
    repository.fail(third, 1_006, 'generation_failed', 1_007);

    expect(repository.countModelGenerationAttemptsSince(principal, 0, 'not-running')).toBe(3);
    expect(repository.getAdvisor(principal, 1_008))
      .toEqual({ state: 'quiet', reason: 'generation_failed' });
  });

  it('withdraws only opportunities backed by changed connector facts', () => {
    repository.enqueue(principal, {
      idempotencyKey: 'manual:source-change', reasons: ['manual_refresh'], requestedAt: 1_000,
    });
    repository.complete(repository.claimNext(principal, 'worker-1', 1_001)!, {
      result: {
        state: 'ready',
        opportunities: [
          {
            ...opportunity('meeting'),
            kind: 'meeting_prep',
            evidence: [{
              ...opportunity().evidence[0]!,
              id: 'knowledge:calendar:v1',
              sourceType: 'calendar',
              sourceRef: 'calendar-fact',
            }],
          },
          opportunity('project'),
        ],
      },
      snapshotHash: 'snapshot-source-change',
      evidenceIds: ['knowledge:calendar:v1', 'project:project-1:v2'],
      completedAt: 1_002,
    });

    expect(repository.invalidateOpportunitiesByEvidenceSources(
      principal, new Set(['calendar', 'mail', 'communication']), 1_003,
    )).toBe(1);
    expect(repository.getAdvisor(principal, 1_004)).toMatchObject({
      state: 'ready',
      primary: { id: 'project' },
    });
  });

  it('uses optimistic concurrency and idempotency for feedback', () => {
    repository.enqueue(principal, {
      idempotencyKey: 'manual:1', reasons: ['manual_refresh'], requestedAt: 1_000,
    });
    repository.complete(repository.claimNext(principal, 'worker-1', 1_001)!, {
      result: { state: 'ready', opportunities: [opportunity()] },
      snapshotHash: 'snapshot-1', evidenceIds: ['project:project-1:v2'], completedAt: 1_002,
    });

    const updated = repository.recordFeedback(principal, 'opportunity-1', {
      idempotencyKey: 'feedback:1', kind: 'snoozed', expectedRevision: 1,
      createdAt: 1_003, snoozedUntil: 2_000,
    });
    expect(updated).toMatchObject({ id: 'opportunity-1', revision: 2 });
    expect(repository.recordFeedback(principal, 'opportunity-1', {
      idempotencyKey: 'feedback:1', kind: 'snoozed', expectedRevision: 1,
      createdAt: 1_004, snoozedUntil: 2_000,
    })).toMatchObject({ revision: 2 });
    expect(() => repository.recordFeedback(principal, 'opportunity-1', {
      idempotencyKey: 'feedback:2', kind: 'irrelevant', expectedRevision: 1, createdAt: 1_005,
    })).toThrow('stale or unavailable');

    expect(repository.getAdvisor(principal, 1_500)).toEqual({ state: 'quiet', reason: 'no_change' });
    expect(repository.maintain(2_000)).toEqual({ expired: 0, awakened: 1 });
    expect(repository.getAdvisor(principal, 2_001)).toMatchObject({
      state: 'ready', primary: { id: 'opportunity-1', revision: 3 },
    });
  });

  it('lists suggestion history and restores the latest reversible feedback', () => {
    repository.enqueue(principal, {
      idempotencyKey: 'history:generation', reasons: ['manual_refresh'], requestedAt: 1_000,
    });
    repository.complete(repository.claimNext(principal, 'worker', 1_001)!, {
      result: { state: 'ready', opportunities: [opportunity('history')] },
      snapshotHash: 'history', evidenceIds: ['project:project-1:v2'], completedAt: 1_002,
    });
    repository.recordFeedback(principal, 'history', {
      idempotencyKey: 'history:feedback', kind: 'irrelevant', expectedRevision: 1, createdAt: 1_003,
    });

    expect(repository.listHistory(principal)).toMatchObject([{
      opportunity: { id: 'history', revision: 2 },
      status: 'dismissed',
      feedbackKind: 'irrelevant',
      updatedAt: 1_003,
    }]);

    expect(repository.undoFeedback(principal, 'history', 'history:feedback', 1_004))
      .toMatchObject({ id: 'history', revision: 3 });
    expect(repository.listHistory(principal)).toMatchObject([{
      opportunity: { id: 'history', revision: 3 },
      status: 'available',
      updatedAt: 1_004,
    }]);
  });

  it('derives a reversible confidence threshold from explicit recent feedback', () => {
    const seedFeedback = (index: number, kind: 'irrelevant' | 'source_incorrect' | 'started') => {
      const item = opportunity(`feedback-${index}`, 1_000 + index);
      repository.enqueue(principal, {
        idempotencyKey: `generation:feedback:${index}`, reasons: ['manual_refresh'], requestedAt: 1_000 + index * 10,
      });
      repository.complete(repository.claimNext(principal, 'worker', 1_001 + index * 10)!, {
        result: { state: 'ready', opportunities: [item] },
        snapshotHash: `snapshot-${index}`, evidenceIds: [item.evidence[0]!.id], completedAt: 1_002 + index * 10,
      });
      repository.recordFeedback(principal, item.id, {
        idempotencyKey: `feedback:${index}`, kind, expectedRevision: 1, createdAt: 1_003 + index * 10,
      });
    };

    seedFeedback(1, 'irrelevant');
    seedFeedback(2, 'source_incorrect');
    seedFeedback(3, 'irrelevant');
    expect(repository.getPersonalization(principal, 2_000).highConfidenceKinds)
      .toEqual(new Set(['project_next_step']));

    seedFeedback(4, 'started');
    seedFeedback(5, 'started');
    expect(repository.getPersonalization(principal, 3_000).highConfidenceKinds).toEqual(new Set());
  });

  it('reports versioned progress metrics instead of card exposure', () => {
    const item = opportunity('metrics', 1_000);
    repository.enqueue(principal, {
      idempotencyKey: 'generation:metrics', reasons: ['manual_refresh'], requestedAt: 1_000,
    });
    repository.complete(repository.claimNext(principal, 'worker', 1_001)!, {
      result: { state: 'ready', opportunities: [item] }, snapshotHash: 'metrics',
      evidenceIds: [item.evidence[0]!.id], estimatedCostUsd: 0.25, completedAt: 1_002,
    });
    repository.recordFeedback(principal, item.id, {
      idempotencyKey: 'metrics:start', kind: 'started', expectedRevision: 1, createdAt: 1_003,
    });
    repository.enqueue(principal, {
      idempotencyKey: 'generation:quiet', reasons: ['manual_refresh'], requestedAt: 1_004,
    });
    repository.complete(repository.claimNext(principal, 'worker', 1_005)!, {
      result: { state: 'quiet', reason: 'insufficient_value' }, snapshotHash: 'quiet',
      evidenceIds: [], completedAt: 1_006,
    });

    expect(repository.getMetrics(principal, 900, 2_000)).toEqual({
      window: { since: 900, until: 2_000 },
      currentStrategyVersion: 'home-v1',
      generations: { total: 2, succeeded: 1, quiet: 1, failed: 0, estimatedCostUsd: 0.25 },
      outcomes: { opportunities: 1, started: 1, discussed: 0, completed: 0, corrected: 0, expired: 0 },
      rates: { start: 1, completionFromStarted: 0, correction: 0 },
      feedback: { alreadyDone: 0, irrelevant: 0, tooEarly: 0, sourceIncorrect: 0, lessLikeThis: 0 },
      strategies: [{ version: 'home-v1', generations: 2, opportunities: 1, started: 1, completed: 0 }],
    });
  });

  it('rejects a stale worker lease after the generation is reclaimed', () => {
    repository.enqueue(principal, {
      idempotencyKey: 'manual:1', reasons: ['manual_refresh'], requestedAt: 1_000,
    });
    const staleClaim = repository.claimNext(principal, 'worker-1', 1_001, 10)!;
    const currentClaim = repository.claimNext(principal, 'worker-2', 1_012, 10)!;

    expect(() => repository.complete(staleClaim, {
      result: { state: 'quiet', reason: 'no_change' },
      snapshotHash: 'old', evidenceIds: [], completedAt: 1_013,
    })).toThrow('lease was lost');
    expect(() => repository.complete(currentClaim, {
      result: { state: 'quiet', reason: 'no_change' },
      snapshotHash: 'new', evidenceIds: [], completedAt: 1_014,
    })).not.toThrow();
  });

  it('isolates idempotency and claims by principal', () => {
    const other = { ownerId: 'other-user', workspaceId: 'other-workspace' };
    const first = repository.enqueue(principal, {
      idempotencyKey: 'same-key', reasons: ['task_changed'], requestedAt: 1_000,
    });
    const second = repository.enqueue(other, {
      idempotencyKey: 'same-key', reasons: ['task_changed'], requestedAt: 1_001,
    });

    expect(second.generationId).not.toBe(first.generationId);
    expect(repository.claimNext(other, 'other-worker', 1_002)).toMatchObject({
      generationId: second.generationId,
      ownerId: other.ownerId,
      workspaceId: other.workspaceId,
    });
    expect(repository.claimNext(other, 'other-worker', 1_003)).toBeUndefined();
    expect(repository.claimNext(principal, 'worker', 1_003)).toMatchObject({ generationId: first.generationId });
  });

  it('moves failed generations through bounded retry states', () => {
    repository.enqueue(principal, {
      idempotencyKey: 'retry:1', reasons: ['scheduled_refresh'], requestedAt: 1_000,
    });
    const first = repository.claimNext(principal, 'worker', 1_001)!;
    expect(() => repository.fail(first, 1_002, 'generation_failed', 2_000)).not.toThrow();
    expect(repository.claimNext(principal, 'worker', 1_999)).toBeUndefined();
    const second = repository.claimNext(principal, 'worker', 2_000)!;
    expect(second.attempt).toBe(2);
  });
});
