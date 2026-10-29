import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  run: vi.fn(async (_input: unknown) => ({ ok: true })),
  hydrate: vi.fn(async (_input: unknown) => ({ images: [] as unknown[] })),
}));
vi.mock('../../embedded/run-for-session.js', () => ({ runEmbeddedTurnForSession: mocks.run }));
vi.mock('../../inbound/attachment-pipeline.js', () => ({ hydrateUserTurnForLlm: mocks.hydrate }));
vi.mock('../../../storage/sqlite/connection-wait-repository.js', () => ({ getConnectionResumeInput: () => undefined }));
vi.mock('../../../storage/sqlite/clarification-wait-repository.js', () => ({ getClarificationResumeInput: () => undefined }));
vi.mock('../../../tasks/task-context-assembler.js', () => ({
  buildTaskExecutionDirective: () => '', buildDelegatedTaskDirective: () => '',
}));
vi.mock('../../image/vision-detection.js', () => ({ resolveImageHandlingStrategy: () => 'native' }));

import { runDirectAgentTurn, type RunDirectAgentTurnDeps } from '../direct-turn-helpers.js';

const input = { conversationId: 'conversation', runId: 'turn',
  userMessage: { role: 'user' as const, content: 'Inspect this image', timestamp: 1 } };

function setup() {
  const prepareContext = vi.fn(async () => ({ dynamicSystemContext: 'Relevant memory' }));
  const deps = {
    agentManager: { prepareUserTurnContext: prepareContext,
      scheduleBackgroundReviewAfterUserTurn: vi.fn(), beginBackgroundReviewUserTurn: vi.fn() },
    modelManager: { getModelForSession: () => 'provider/model' }, sessionStore: {},
  } as unknown as RunDirectAgentTurnDeps;
  return { deps, prepareContext };
}

describe('direct turn preparation', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] }); });
  afterEach(() => vi.useRealTimers());

  it('overlaps independent preparation and preserves memory, image order and source context', async () => {
    const { deps, prepareContext } = setup();
    const image = { type: 'image', data: 'image', mimeType: 'image/png' };
    const sourceImage = { type: 'image' as const, data: 'source', mimeType: 'image/png' };
    prepareContext.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { dynamicSystemContext: 'Relevant memory' };
    });
    mocks.hydrate.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 120));
      return { images: [image] };
    });
    const sequentialStarted = performance.now();
    const sequential = (async () => { await prepareContext(); await mocks.hydrate({}); })();
    await vi.advanceTimersByTimeAsync(320);
    await sequential;
    expect(performance.now() - sequentialStarted).toBe(320);
    vi.clearAllMocks();
    const started = performance.now();
    const turning = runDirectAgentTurn(deps, { ...input, sourceImages: [sourceImage] });
    await vi.advanceTimersByTimeAsync(120);
    expect(prepareContext).toHaveBeenCalledOnce();
    expect(mocks.hydrate).toHaveBeenCalledOnce();
    expect(mocks.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(80);
    await turning;
    expect(performance.now() - started).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      dynamicSystemContext: 'Relevant memory', llmImages: [image, sourceImage],
      userMessage: input.userMessage,
    }));
  });

  it.each(['context', 'media'] as const)('settles the other branch when %s preparation fails before releasing the turn', async failing => {
    const { deps, prepareContext } = setup();
    const error = new Error(`${failing} unavailable`);
    let pendingFinished = false;
    const pending = async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      pendingFinished = true;
    };
    prepareContext.mockImplementation(async () => {
      if (failing === 'context') throw error;
      await pending();
      return { dynamicSystemContext: 'memory' };
    });
    mocks.hydrate.mockImplementation(async () => {
      if (failing === 'media') throw error;
      await pending();
      return { images: [] };
    });
    let released = false;
    const turning = runDirectAgentTurn(deps, input).catch(err => { released = true; return err; });
    await vi.advanceTimersByTimeAsync(1);
    expect(released).toBe(false);
    expect(pendingFinished).toBe(false);
    await vi.advanceTimersByTimeAsync(99);
    expect(await turning).toBe(error);
    expect(pendingFinished).toBe(true);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(deps.agentManager.scheduleBackgroundReviewAfterUserTurn).not.toHaveBeenCalled();
  });
});
