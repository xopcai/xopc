import type { Agent } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import { ConfigSchema, type Config } from '../../../config/schema.js';
import type { UserContextConfig } from '../../../user-context/config.js';
import { BackgroundReviewCoordinator } from '../coordinator.js';

const runBackgroundUserModelReview = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../run-background-review.js', () => ({ runBackgroundUserModelReview }));

function config(userModel?: Partial<UserContextConfig['userModel']>): Config {
  const base = ConfigSchema.parse({});
  return ConfigSchema.parse({
    ...base,
    userContext: {
      ...base.userContext,
      userModel: {
        ...base.userContext.userModel,
        ...userModel,
        extraction: { ...base.userContext.userModel.extraction, ...userModel?.extraction },
      },
    },
  });
}

describe('BackgroundReviewCoordinator', () => {
  it('schedules understanding by cadence without a storage mutation tool dependency', async () => {
    const cfg = config({ extraction: { ...ConfigSchema.parse({}).userContext.userModel.extraction, reviewIntervalTurns: 2 } });
    const coordinator = new BackgroundReviewCoordinator({ getConfig: () => cfg });
    const agent = {
      state: {
        messages: [{ role: 'assistant', content: 'Done.', stopReason: 'stop' }],
      },
    } as unknown as Agent;
    const workspaceId = '/workspace';

    coordinator.beginUserTurn('main:test');
    coordinator.scheduleAfterUserTurn({
      sessionKey: 'main:test',
      agent,
      lastAssistantText: 'Done.',
      workspaceId,
    });
    await Promise.resolve();
    expect(runBackgroundUserModelReview).not.toHaveBeenCalled();

    coordinator.beginUserTurn('main:test');
    coordinator.scheduleAfterUserTurn({
      sessionKey: 'main:test',
      agent,
      lastAssistantText: 'Done.',
      workspaceId,
    });
    await vi.waitFor(() => expect(runBackgroundUserModelReview).toHaveBeenCalledTimes(1));
  });
});
