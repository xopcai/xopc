import type { Agent } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import { ConfigSchema, type Config } from '../../../config/schema.js';
import type { UserContextConfig } from '../../../user-context/config.js';
import type { WorkspaceRuntime } from '../../workspace-runtime/registry.js';
import { BackgroundReviewCoordinator } from '../coordinator.js';

const runBackgroundReviewTurn = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../run-background-review.js', () => ({ runBackgroundReviewTurn }));

function config(memory: UserContextConfig['memory'], understanding?: Partial<UserContextConfig['understanding']>): Config {
  const base = ConfigSchema.parse({});
  return ConfigSchema.parse({
    ...base,
    userContext: { ...base.userContext, memory, understanding: { ...base.userContext.understanding, ...understanding } },
  });
}

describe('BackgroundReviewCoordinator', () => {
  it('schedules understanding by cadence without a curated-memory tool dependency', async () => {
    const cfg = config({
      mode: 'confirmWrite',
      sources: ['session'],
    }, { reviewIntervalTurns: 2 });
    const coordinator = new BackgroundReviewCoordinator({ getConfig: () => cfg });
    const agent = {
      state: {
        messages: [{ role: 'assistant', content: 'Done.', stopReason: 'stop' }],
      },
    } as unknown as Agent;
    const workspaceRuntime = {
      memoryManager: { applyUnderstandingCandidates: vi.fn() },
    } as unknown as WorkspaceRuntime;

    coordinator.beginUserTurn('main:test');
    coordinator.scheduleAfterUserTurn({
      sessionKey: 'main:test',
      agent,
      lastAssistantText: 'Done.',
      workspaceRuntime,
    });
    await Promise.resolve();
    expect(runBackgroundReviewTurn).not.toHaveBeenCalled();

    coordinator.beginUserTurn('main:test');
    coordinator.scheduleAfterUserTurn({
      sessionKey: 'main:test',
      agent,
      lastAssistantText: 'Done.',
      workspaceRuntime,
    });
    await vi.waitFor(() => expect(runBackgroundReviewTurn).toHaveBeenCalledTimes(1));
  });
});
