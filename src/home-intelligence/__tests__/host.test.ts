import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, vi } from 'vitest';

import { ensureXopcDatabaseSchema } from '../../storage/sqlite/schema.js';
import type { HomeCapabilityRequirement, HomeCapabilityResolution } from '../capability-preflight.js';
import { HomeIntelligenceHost } from '../host.js';
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

function seedDailyProviderUsage(db: DatabaseSync, count: number, tokensPerCall = 1): void {
  for (let index = 0; index < count; index += 1) {
    db.prepare(`INSERT INTO ai_usage_events (
      id, trace_id, category, operation, trigger_kind, reason_key, provider, model,
      status, started_at, total_tokens, cost_source, created_at, updated_at
    ) VALUES (?, ?, 'home_intelligence', 'home.generate_advice', 'system', 'usage.reason.homeAdvice',
      'test', 'reasoning', 'succeeded', ?, ?, 'unknown', ?, ?)`).run(
      `usage:${index}`, `trace:${index}`, index + 1, tokensPerCall, index + 1, index + 1,
    );
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
    host.requestRefresh('task_changed', 'task:2', 'zh');
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
    host.requestRefresh('task_changed', 'task:1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await host.tick();
    expect(host.getAdvisor()).toEqual({ state: 'quiet', reason: 'model_unavailable' });
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
    await vi.waitFor(() => expect(host.getAdvisor()).toEqual({ state: 'quiet', reason: 'insufficient_value' }));
    connectors = new Set(['google-calendar']);
    now += 1_000;
    host.requestRefresh('connector_changed', 'connector:1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await host.tick();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    host.stop();
    db.close();
  });

  it('coalesces meaningful context changes behind a global cooldown', async () => {
    const db = database();
    let now = 1_000;
    let health: 'on_track' | 'at_risk' | 'blocked' = 'on_track';
    const generate = vi.fn(async () => ({
      modelRef: 'test/reasoning', usage: {}, result: { state: 'quiet' as const, reason: 'insufficient_value' as const },
    }));
    const host = new HomeIntelligenceHost(db, {
      principal: { ownerId: 'owner', workspaceId: 'workspace' },
      snapshot: new HomeSnapshotBuilder({
        projects: () => [{
          id: 'atlas', name: 'Atlas', slug: 'atlas', status: 'active', health, executionMode: 'local_checkout',
          successCriteria: [], scope: {}, nonGoals: [], version: 1, createdAt: 1, updatedAt: now,
        }],
        tasks: () => [], knowledge: () => [],
      }),
      generator: { generate },
      capabilities: () => ({ agentId: 'main', connectors: new Set(), skills: new Set() }),
      resolveCapabilities: resolveReady,
      notifyOpportunity: vi.fn(), publish: vi.fn(), locale: () => 'en', now: () => now,
    });
    host.requestRefresh('manual_refresh', 'manual:baseline');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(host.getAdvisor()).toEqual({ state: 'quiet', reason: 'insufficient_value' }));

    now += 1_000;
    health = 'at_risk';
    host.requestRefresh('project_changed', 'project:first');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(host.getAdvisor()).toEqual({ state: 'quiet', reason: 'insufficient_value' }));

    now += 1_000;
    health = 'blocked';
    expect(host.requestRefresh('task_changed', 'task:second')).toBe('cooldown');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(generate).toHaveBeenCalledTimes(2);
    host.stop();
    db.close();
  });

  it('enforces the provider-call budget for automatic and manual refreshes', async () => {
    const db = database();
    seedDailyProviderUsage(db, 12);
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

    host.requestRefresh('task_changed', 'task:budget');
    await vi.waitFor(() => expect(host.getAdvisor()).toEqual({ state: 'quiet', reason: 'budget_exhausted' }));
    expect(generate).not.toHaveBeenCalled();

    now += 1;
    host.requestRefresh('manual_refresh', 'manual:budget');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await host.tick();
    expect(generate).not.toHaveBeenCalled();
    expect(host.getAdvisor()).toEqual({ state: 'quiet', reason: 'budget_exhausted' });
    host.stop();
    db.close();
  });

  it('enforces the daily token budget before another provider call', async () => {
    const db = database();
    seedDailyProviderUsage(db, 1, 120_000);
    const generate = vi.fn();
    const host = new HomeIntelligenceHost(db, {
      principal: { ownerId: 'owner', workspaceId: 'workspace' },
      snapshot: new HomeSnapshotBuilder({ projects: () => [], tasks: () => [], knowledge: () => [] }),
      generator: { generate },
      capabilities: () => ({ agentId: 'main', connectors: new Set(), skills: new Set() }),
      resolveCapabilities: resolveReady,
      notifyOpportunity: vi.fn(), publish: vi.fn(), locale: () => 'en', now: () => 20_000,
    });
    host.requestRefresh('manual_refresh', 'manual:token-budget');
    await vi.waitFor(() => expect(host.getAdvisor()).toEqual({ state: 'quiet', reason: 'budget_exhausted' }));
    expect(generate).not.toHaveBeenCalled();
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
    expect(host.requestRefresh('task_changed')).toBe('disabled');
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
