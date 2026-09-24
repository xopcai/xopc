import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, vi } from 'vitest';

import { ensureXopcDatabaseSchema } from '../../storage/sqlite/schema.js';
import type { HomeCapabilityRequirement, HomeCapabilityResolution } from '../capability-preflight.js';
import { HomeIntelligenceHost } from '../host.js';
import { HomeIntelligenceRepository } from '../repository.js';
import { HomeSnapshotBuilder } from '../snapshot.js';

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  ensureXopcDatabaseSchema(db);
  return db;
}

function resolveReady(requirements: readonly HomeCapabilityRequirement[]): HomeCapabilityResolution {
  return {
    capabilities: requirements.map((requirement) => ({
      ...requirement,
      resolvedId: requirement.capability,
      readiness: 'ready' as const,
    })),
    preflight: { state: 'ready' },
  };
}

function seedDailyModelBudget(db: DatabaseSync, count: number): void {
  const repository = new HomeIntelligenceRepository(db);
  for (let index = 0; index < count; index += 1) {
    repository.enqueue({ ownerId: 'owner', workspaceId: 'workspace' }, {
      idempotencyKey: `seed:${index}`, reasons: ['scheduled_refresh'], requestedAt: index + 1,
    });
    const claim = repository.claimNext({ ownerId: 'owner', workspaceId: 'workspace' }, 'seed-worker', index + 1)!;
    repository.complete(claim, {
      result: { state: 'quiet', reason: 'insufficient_value' },
      snapshotHash: `seed-${index}`, evidenceIds: [], modelRef: 'test/reasoning', completedAt: index + 1,
    });
  }
}

describe('HomeIntelligenceHost', () => {
  it('generates grounded advice and skips an unchanged snapshot on the next refresh', async () => {
    const db = database();
    let now = 1_000;
    const publish = vi.fn();
    const generate = vi.fn(async () => ({
      modelRef: 'test/reasoning', usage: {},
      result: {
        state: 'ready' as const,
        candidates: [{
          kind: 'project_next_step' as const,
          projectId: 'atlas', title: '明确 Atlas 下一步', outcome: '得到可执行计划',
          rationale: '项目仍在推进', evidenceIds: ['project:atlas:v10'], confidence: 'high' as const,
          urgency: 'today' as const, risk: 'analysis' as const, proposedSteps: ['检查当前目标'],
          requiredCapabilities: [], verification: ['下一步有明确验收条件'], actionPrompt: '检查 Atlas 并提出下一步。',
        }],
      },
    }));
    const host = new HomeIntelligenceHost(db, {
      principal: { ownerId: 'owner', workspaceId: 'workspace' },
      snapshot: new HomeSnapshotBuilder({
        projects: () => [{
          id: 'atlas', name: 'Atlas', slug: 'atlas', status: 'active', health: 'on_track', executionMode: 'local_checkout',
          successCriteria: [], scope: {}, nonGoals: [], version: 1, createdAt: 1, updatedAt: 10,
        }],
        tasks: () => [], knowledge: () => [],
      }),
      generator: { generate },
      capabilities: () => ({ agentId: 'main', connectors: new Set(), skills: new Set() }),
      resolveCapabilities: resolveReady,
      notifyOpportunity: vi.fn(),
      publish,
      locale: () => 'zh',
      now: () => now,
    });

    host.requestRefresh('manual_refresh', 'manual:1', 'zh');
    await vi.waitFor(() => expect(host.getAdvisor()).toMatchObject({ state: 'ready', primary: { title: '明确 Atlas 下一步' } }));
    expect(generate).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith('home.advisor.updated', expect.objectContaining({ state: 'ready' }));

    now += 1_000;
    host.requestRefresh('home_opened', 'open:2', 'zh');
    await vi.waitFor(() => expect(host.getAdvisor()).toMatchObject({ state: 'ready', stale: false }));
    expect(generate).toHaveBeenCalledOnce();
    expect(host.getAdvisor()).toMatchObject({ state: 'ready', stale: false });
    host.stop();
    db.close();
  });

  it('degrades missing model credentials to a quiet state without retrying forever', async () => {
    const db = database();
    const generate = vi.fn(async () => { throw new Error('No API key for provider: test'); });
    const host = new HomeIntelligenceHost(db, {
      principal: { ownerId: 'owner', workspaceId: 'workspace' },
      snapshot: new HomeSnapshotBuilder({ projects: () => [], tasks: () => [], knowledge: () => [] }),
      generator: { generate },
      capabilities: () => ({ agentId: 'main', connectors: new Set(), skills: new Set() }),
      resolveCapabilities: resolveReady,
      notifyOpportunity: vi.fn(),
      publish: vi.fn(), locale: () => 'en', now: () => 1_000,
    });
    host.requestRefresh('manual_refresh', 'manual:1');
    await vi.waitFor(() => expect(host.getAdvisor()).toEqual({ state: 'quiet', reason: 'model_unavailable' }));
    host.requestRefresh('home_opened', 'open:1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await host.tick();
    await vi.waitFor(() => expect(host.getAdvisor()).toEqual({ state: 'quiet', reason: 'no_change' }));
    expect(generate).toHaveBeenCalledOnce();
    host.stop();
    db.close();
  });

  it('regenerates when capability readiness changes', async () => {
    const db = database();
    let connectors = new Set<string>();
    let now = 1_000;
    const generate = vi.fn(async () => ({
      modelRef: 'test/reasoning', usage: {}, result: { state: 'quiet' as const, reason: 'insufficient_value' as const },
    }));
    const host = new HomeIntelligenceHost(db, {
      principal: { ownerId: 'owner', workspaceId: 'workspace' },
      snapshot: new HomeSnapshotBuilder({ projects: () => [], tasks: () => [], knowledge: () => [] }),
      generator: { generate },
      capabilities: () => ({ agentId: 'main', connectors, skills: new Set() }),
      resolveCapabilities: resolveReady,
      notifyOpportunity: vi.fn(),
      publish: vi.fn(), locale: () => 'en', now: () => now,
    });
    host.requestRefresh('manual_refresh', 'manual:1');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    connectors = new Set(['google-calendar']);
    now += 1_000;
    host.requestRefresh('connector_changed', 'connector:1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await host.tick();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    host.stop();
    db.close();
  });

  it('reports an exhausted automatic budget but lets a manual refresh retry', async () => {
    const db = database();
    seedDailyModelBudget(db, 12);
    let now = 20_000;
    const generate = vi.fn(async () => ({
      modelRef: 'test/reasoning', usage: {},
      result: { state: 'quiet' as const, reason: 'insufficient_value' as const },
    }));
    const host = new HomeIntelligenceHost(db, {
      principal: { ownerId: 'owner', workspaceId: 'workspace' },
      snapshot: new HomeSnapshotBuilder({ projects: () => [], tasks: () => [], knowledge: () => [] }),
      generator: { generate },
      capabilities: () => ({ agentId: 'main', connectors: new Set(), skills: new Set() }),
      resolveCapabilities: resolveReady,
      notifyOpportunity: vi.fn(), publish: vi.fn(), locale: () => 'en', now: () => now,
    });

    host.requestRefresh('home_opened', 'open:budget');
    await vi.waitFor(() => expect(host.getAdvisor()).toEqual({ state: 'quiet', reason: 'budget_exhausted' }));
    expect(generate).not.toHaveBeenCalled();

    now += 1;
    host.requestRefresh('manual_refresh', 'manual:budget');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(host.getAdvisor()).toEqual({ state: 'quiet', reason: 'insufficient_value' }));
    host.stop();
    db.close();
  });

  it('does not enqueue or expose advice when user context is disabled', () => {
    const db = database();
    const host = new HomeIntelligenceHost(db, {
      principal: { ownerId: 'owner', workspaceId: 'workspace' },
      snapshot: new HomeSnapshotBuilder({ projects: () => [], tasks: () => [], knowledge: () => [] }),
      generator: { generate: vi.fn() },
      capabilities: () => ({ agentId: 'main', connectors: new Set(), skills: new Set() }),
      resolveCapabilities: resolveReady,
      notifyOpportunity: vi.fn(),
      publish: vi.fn(), locale: () => 'en', enabled: () => false,
    });
    expect(host.requestRefresh('home_opened')).toBe('disabled');
    expect(host.getAdvisor()).toEqual({ state: 'disabled' });
    host.stop();
    db.close();
  });

  it('returns structured setup recovery without mutating the opportunity', async () => {
    const db = database();
    const host = new HomeIntelligenceHost(db, {
      principal: { ownerId: 'owner', workspaceId: 'workspace' },
      snapshot: new HomeSnapshotBuilder({
        projects: () => [{
          id: 'atlas', name: 'Atlas', slug: 'atlas', status: 'active', health: 'on_track', executionMode: 'local_checkout',
          successCriteria: [], scope: {}, nonGoals: [], version: 1, createdAt: 1, updatedAt: 10,
        }],
        tasks: () => [], knowledge: () => [],
      }),
      generator: { generate: vi.fn(async () => ({
        modelRef: 'test/reasoning', usage: {},
        result: {
          state: 'ready' as const,
          candidates: [{
            kind: 'project_next_step' as const, projectId: 'atlas', title: '准备评审会议', outcome: '形成评审提纲',
            rationale: '项目正在推进', evidenceIds: ['project:atlas:v10'], confidence: 'high' as const,
            urgency: 'today' as const, risk: 'external_read' as const, proposedSteps: ['读取日程'],
            requiredCapabilities: [{ kind: 'connector' as const, capability: 'composio-calendar', required: true }],
            verification: ['提纲可供确认'], actionPrompt: '读取日程并准备会议。',
            degradedActionPrompt: '仅使用项目证据准备待确认提纲。',
          }],
        },
      })) },
      capabilities: () => ({ agentId: 'main', connectors: new Set(), skills: new Set() }),
      resolveCapabilities: (requirements, options) => ({
        capabilities: requirements.map((item) => ({ ...item, readiness: 'needs_setup' as const, recoveryPath: '/connectors?returnTo=%2F', reason: 'Calendar is not connected.' })),
        preflight: {
          state: 'needs_setup',
          blockers: [{
            kind: 'connector', capability: 'composio-calendar', code: 'connection_missing',
            message: 'Calendar is not connected.', recoveryPath: '/connectors?returnTo=%2F',
          }],
          recoveryActions: [{ capability: 'composio-calendar', href: '/connectors?returnTo=%2F' }],
          ...(options?.degradedActionAvailable ? { degradedAction: { mode: 'degraded_start' as const } } : {}),
        },
      }),
      notifyOpportunity: vi.fn(),
      publish: vi.fn(), locale: () => 'zh', now: () => 1_000,
    });
    host.requestRefresh('manual_refresh', 'manual:setup');
    await vi.waitFor(() => expect(host.getAdvisor()).toMatchObject({ state: 'ready' }));
    const advisor = host.getAdvisor();
    if (advisor.state !== 'ready') throw new Error('Expected ready advisor');
    expect(host.act(advisor.primary.id, {
      idempotencyKey: 'start:setup', expectedRevision: advisor.primary.revision, mode: 'start',
    })).toMatchObject({
      outcome: 'needs_setup',
      preflight: { state: 'needs_setup', degradedAction: { mode: 'degraded_start' } },
    });
    expect(host.getAdvisor()).toMatchObject({ state: 'ready', primary: { revision: 1 } });
    host.stop();
    db.close();
  });
});
