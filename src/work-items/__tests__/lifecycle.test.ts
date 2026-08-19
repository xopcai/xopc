import { describe, expect, it } from 'vitest';

import type { WorkItem } from '@xopcai/gateway-contract';

import {
  availableWorkItemCommands,
  transitionWorkItem,
  WorkItemTransitionError,
} from '../lifecycle.js';

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi-1',
    projectId: 'p-1',
    title: 'Ship lifecycle',
    priority: 'normal',
    phase: 'ready',
    completionPolicy: 'agent_verified',
    waits: [],
    links: [],
    attachments: [],
    version: 1,
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

const user = { actor: { kind: 'user' as const, id: 'u-1' }, now: 20, createId: () => 'wait-1' };
const agent = { actor: { kind: 'agent' as const, id: 'a-1' }, now: 20, createId: () => 'wait-1' };

describe('work item lifecycle', () => {
  it('moves through the normal agent-verified lifecycle', () => {
    const started = transitionWorkItem(item(), { type: 'start', expectedVersion: 1 }, agent).item;
    expect(started).toMatchObject({ phase: 'executing', version: 2, startedAt: 20 });

    const reviewing = transitionWorkItem(
      started,
      { type: 'request_review', expectedVersion: 2, summary: 'Tests pass' },
      { ...agent, now: 30 },
    ).item;
    expect(reviewing).toMatchObject({ phase: 'verifying', version: 3, reviewRequestedAt: 30 });

    const completed = transitionWorkItem(
      reviewing,
      { type: 'complete', expectedVersion: 3, summary: 'Verified' },
      { ...agent, now: 40 },
    ).item;
    expect(completed).toMatchObject({ phase: 'closed', resolution: 'completed', closedAt: 40, version: 4 });
  });

  it('requires the user to accept user-accepted work', () => {
    const reviewing = transitionWorkItem(
      item({ phase: 'executing', completionPolicy: 'user_accepted' }),
      { type: 'request_review', expectedVersion: 1, summary: 'Please approve' },
      agent,
    ).item;
    expect(reviewing.waits).toEqual([
      expect.objectContaining({ id: 'wait-1', kind: 'user_approval', reason: 'Please approve' }),
    ]);
    expect(() => transitionWorkItem(reviewing, { type: 'accept', expectedVersion: 2 }, agent))
      .toThrowError(WorkItemTransitionError);
    const accepted = transitionWorkItem(reviewing, { type: 'accept', expectedVersion: 2 }, user).item;
    expect(accepted).toMatchObject({ phase: 'closed', resolution: 'completed' });
    expect(accepted.waits[0]).toMatchObject({ resolvedAt: 20 });
  });

  it('keeps waits orthogonal to phase and resolves them explicitly', () => {
    const waiting = transitionWorkItem(
      item({ phase: 'executing' }),
      {
        type: 'wait',
        expectedVersion: 1,
        wait: { kind: 'user_input', reason: 'Choose a region' },
      },
      agent,
    ).item;
    expect(waiting).toMatchObject({ phase: 'executing', version: 2 });
    expect(waiting.waits[0]).toMatchObject({ kind: 'user_input' });
    expect(waiting.waits[0]?.resolvedAt).toBeUndefined();
    expect(() => transitionWorkItem(waiting, { type: 'resume', expectedVersion: 2, waitId: 'wait-1' }, agent))
      .toThrowError(/Only a user/);
    const resumed = transitionWorkItem(waiting, { type: 'resume', expectedVersion: 2, waitId: 'wait-1' }, user).item;
    expect(resumed.phase).toBe('executing');
    expect(resumed.waits[0]).toMatchObject({ resolvedAt: 20 });
  });

  it('rejects illegal transitions and stale commands', () => {
    expect(() => transitionWorkItem(item(), { type: 'commit', expectedVersion: 1 }, user))
      .toThrowError(/phase ready/);
    expect(() => transitionWorkItem(item(), { type: 'start', expectedVersion: 9 }, user))
      .toThrowError(/Expected work item version 9/);
  });

  it('exposes only commands allowed for the current actor', () => {
    const reviewing = item({ phase: 'verifying', completionPolicy: 'user_accepted' });
    expect(availableWorkItemCommands(reviewing, agent.actor)).not.toContain('accept');
    expect(availableWorkItemCommands(reviewing, user.actor)).toContain('accept');
    expect(availableWorkItemCommands(reviewing, user.actor)).not.toContain('complete');
  });
});
