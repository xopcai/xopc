import type { Agent } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import { ConfigSchema, type Config } from '../../../config/schema.js';
import type { UserContextConfig } from '../../../user-context/config.js';
import { BackgroundReviewCoordinator } from '../coordinator.js';

const runBackgroundUserModelReview = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const createBackgroundUserModelReviewTask = vi.hoisted(() => vi.fn(() => runBackgroundUserModelReview));

vi.mock('../run-background-review.js', () => ({ createBackgroundUserModelReviewTask }));

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
    const firstReview = coordinator.createReviewTaskAfterUserTurn({
      conversationId: 'main:test',
      agent,
      lastAssistantText: 'Done.',
      workspaceId,
    });
    expect(firstReview).toBeUndefined();
    expect(runBackgroundUserModelReview).not.toHaveBeenCalled();

    coordinator.beginUserTurn('main:test');
    const secondReview = coordinator.createReviewTaskAfterUserTurn({
      conversationId: 'main:test',
      agent,
      lastAssistantText: 'Done.',
      workspaceId,
    });
    expect(secondReview).toBeTypeOf('function');
    expect(createBackgroundUserModelReviewTask).toHaveBeenCalledTimes(1);
    await secondReview?.();
    expect(runBackgroundUserModelReview).toHaveBeenCalledTimes(1);
  });
});
