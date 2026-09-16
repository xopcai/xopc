import { describe, expect, it, vi } from 'vitest';

import type { SessionStore } from '../../../session/store.js';
import { SessionInspector } from '../session-inspector.js';

describe('SessionInspector', () => {
  it('uses the effective session context window for context usage', async () => {
    const conversationId = 'agent:main:webchat:default:direct:ctx-window';
    const messages = [{ role: 'user', content: 'hello' }];
    const sessionHydrator = { model: vi.fn(async () => undefined) };
    const getContextWindow = vi.fn(() => 32_000);
    const estimateTokenUsage = vi.fn(async () => 8_000);

    const inspector = new SessionInspector({
      sessionStore: {
        load: vi.fn(async () => messages),
        estimateTokenUsage,
      } as unknown as SessionStore,
      sessionConfigStore: {} as never,
      modelManager: {} as never,
      agentManager: {} as never,
      sessionHydrator: sessionHydrator as never,
      getConfig: () => undefined,
      getContextWindow,
    });

    const usage = await inspector.contextUsage(conversationId);

    expect(sessionHydrator.model).toHaveBeenCalledWith(conversationId);
    expect(getContextWindow).toHaveBeenCalledWith(conversationId);
    expect(estimateTokenUsage).toHaveBeenCalledWith(conversationId, messages);
    expect(usage).toEqual({
      estimatedTokens: 8_000,
      contextWindow: 32_000,
      usagePercent: 25,
    });
  });
});
