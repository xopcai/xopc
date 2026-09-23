import { describe, expect, it } from 'vitest';

import type { Task } from '@xopcai/gateway-contract';

import type { KnowledgeItem } from '../../knowledge-memory/domain.js';
import type { Project } from '../../projects/types.js';
import { HomeSnapshotBuilder } from '../snapshot.js';

const project = {
  id: 'atlas', name: 'Atlas', slug: 'atlas', status: 'active', health: 'on_track',
  executionMode: 'local_checkout', successCriteria: [], scope: {}, nonGoals: [], version: 1,
  createdAt: 1, updatedAt: 10,
} as Project;
const task = {
  id: 'task-1', title: 'Prepare release', phase: 'ready', priority: 'high', source: 'api',
  latestContractVersion: 1, boardRank: 1, version: 1, createdAt: 1, updatedAt: 11,
  projectId: 'atlas', contract: { objective: 'Ship Atlas this week' },
} as Task;
const knowledge = {
  id: 'knowledge-1', principalId: 'local-owner', kind: 'commitment', scope: { type: 'project', id: 'atlas' },
  content: 'The release is expected this week.', canonicalKey: 'atlas-release', recordClass: 'memory',
  status: 'active', confidence: 1, importance: 1, originClass: 'owner', derivedFromRecalledContext: false,
  source: {}, createdAt: 1, updatedAt: 12,
} as KnowledgeItem;
const connectedKnowledge = {
  ...knowledge,
  id: 'knowledge-connector',
  canonicalKey: 'calendar-event',
  recordClass: 'source_index',
  source: { provider: 'composio-googlecalendar', sourceInstanceId: 'composio:composio-googlecalendar:work' },
} as KnowledgeItem;

describe('HomeSnapshotBuilder', () => {
  it('builds bounded evidence and a hash that changes only with source content', () => {
    const builder = new HomeSnapshotBuilder({
      projects: () => [project], tasks: () => [task], knowledge: () => [knowledge],
    });
    const first = builder.build({ now: 100, locale: 'en' });
    const later = builder.build({ now: 200, locale: 'en' });
    expect(first.hash).toBe(later.hash);
    expect(first.evidence.map((item) => item.sourceType)).toEqual(['project', 'task', 'user_model']);
    expect(first.tasks[0]).toMatchObject({ objective: 'Ship Atlas this week' });

    const changed = new HomeSnapshotBuilder({
      projects: () => [{ ...project, health: 'at_risk' }], tasks: () => [task], knowledge: () => [knowledge],
    }).build({ now: 200, locale: 'en' });
    expect(changed.hash).not.toBe(first.hash);
  });

  it('excludes knowledge outside the configured read policy', () => {
    const snapshot = new HomeSnapshotBuilder({
      projects: () => [project],
      tasks: () => [task],
      knowledge: () => [knowledge, connectedKnowledge],
      knowledgePolicy: () => ({
        scopes: ['global', 'project'],
        contentSources: ['memory'],
      }),
    }).build({ now: 100, locale: 'en' });

    expect(snapshot.knowledge.map((item) => item.id)).toEqual(['knowledge-1']);
  });

  it('classifies synchronized connector facts without exposing raw source metadata', () => {
    const snapshot = new HomeSnapshotBuilder({
      projects: () => [project],
      tasks: () => [],
      knowledge: () => [connectedKnowledge],
      knowledgePolicy: () => ({ scopes: ['project'], contentSources: ['connector'] }),
    }).build({ now: 100, locale: 'en' });

    expect(snapshot.knowledge).toEqual([expect.objectContaining({
      id: 'knowledge-connector',
      sourceType: 'calendar',
      provider: 'composio-googlecalendar',
    })]);
    expect(snapshot.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'calendar',
        href: '/connectors?connector=composio-googlecalendar',
        freshUntil: 100 + 6 * 60 * 60_000,
      }),
    ]));
  });

  it('includes bounded successful patterns in the generation fingerprint', () => {
    const builder = new HomeSnapshotBuilder({
      projects: () => [project], tasks: () => [], knowledge: () => [],
    });
    const withoutHistory = builder.build({ now: 100, locale: 'en' });
    const withHistory = builder.build({
      now: 100,
      locale: 'en',
      successfulPatterns: [{
        projectId: 'atlas', title: 'Prepare release', outcome: 'A reviewed release checklist.', successCount: 2,
      }],
    });

    expect(withHistory.successfulPatterns).toEqual([{
      projectId: 'atlas', title: 'Prepare release', outcome: 'A reviewed release checklist.', successCount: 2,
    }]);
    expect(withHistory.hash).not.toBe(withoutHistory.hash);
  });
});
