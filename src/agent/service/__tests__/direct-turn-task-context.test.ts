import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(async (_input: unknown) => ({ ok: true })) }));
vi.mock('../../embedded/run-for-session.js', () => ({ runEmbeddedTurnForSession: mocks.run }));
vi.mock('../../../storage/sqlite/connection-wait-repository.js', () => ({ getConnectionResumeInput: () => undefined }));
vi.mock('../../../storage/sqlite/clarification-wait-repository.js', () => ({ getClarificationResumeInput: () => undefined }));
vi.mock('../../inbound/attachment-pipeline.js', () => ({ hydrateUserTurnForLlm: async () => ({ images: [] }) }));
vi.mock('../../image/vision-detection.js', () => ({ resolveImageHandlingStrategy: () => 'native' }));
vi.mock('../../../tasks/task-context-assembler.js', () => ({
  buildTaskExecutionDirective: () => 'Task answer id=answer-1 delivery=delivered: Use CNY. Acknowledge answer-1.',
  buildDelegatedTaskDirective: () => 'Owner question id=question-1: Which label?',
}));

import { runDirectAgentTurn, type RunDirectAgentTurnDeps } from '../direct-turn-helpers.js';

describe('Task collaboration context in direct turns', () => {
  it('places fresh coordination in model system context independently of the persisted user message', async () => {
    const deps = {
      agentManager: {
        prepareUserTurnContext: async () => ({ dynamicSystemContext: 'Other dynamic context' }),
        scheduleBackgroundReviewAfterUserTurn: vi.fn(),
        beginBackgroundReviewUserTurn: vi.fn(),
      },
      modelManager: { getModelForSession: () => 'provider/model' },
      sessionStore: {},
    } as unknown as RunDirectAgentTurnDeps;
    await runDirectAgentTurn(deps, { conversationId: 'conversation', runId: 'turn',
      userMessage: { role: 'user', content: 'Resume original Task', timestamp: 1 } });
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: expect.objectContaining({ content: 'Resume original Task' }),
      dynamicSystemContext: expect.stringContaining('answer-1 delivery=delivered'),
    }));
    const input = mocks.run.mock.calls[0][0] as { dynamicSystemContext: string };
    expect(input.dynamicSystemContext).toContain('Other dynamic context');
    expect(input.dynamicSystemContext).toContain('question-1');
  });
});
