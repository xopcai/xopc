import { describe, expect, it, vi } from 'vitest';

import type { SessionStore } from '../../../session/store.js';
import { SessionInspector } from '../session-inspector.js';

describe('SessionInspector', () => {
  it('uses the effective session context window for context usage', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:ctx-window';
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

    const usage = await inspector.contextUsage(sessionKey);

    expect(sessionHydrator.model).toHaveBeenCalledWith(sessionKey);
    expect(getContextWindow).toHaveBeenCalledWith(sessionKey);
    expect(estimateTokenUsage).toHaveBeenCalledWith(sessionKey, messages);
    expect(usage).toEqual({
      estimatedTokens: 8_000,
      contextWindow: 32_000,
      usagePercent: 25,
    });
  });
});
