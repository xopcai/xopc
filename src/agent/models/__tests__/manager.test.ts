import { describe, expect, it, vi } from 'vitest';

const { resolveModel } = vi.hoisted(() => ({
  resolveModel: vi.fn((ref: string) => {
    if (ref === 'xopc-cloud/deepseek-v4-flash') {
      throw new Error(`Model not found: ${ref}`);
    }
    const [provider, id] = ref.split('/', 2);
    if (!provider || !id) throw new Error(`Model not found: ${ref}`);
    return { provider, id };
  }),
}));

vi.mock('../../../providers/index.js', () => ({
  getAllModels: vi.fn(() => []),
  getDefaultModelSync: vi.fn(() => 'xopc-cloud/deepseek-v4-flash'),
  resolveModel,
}));

import { ModelManager } from '../manager.js';

describe('ModelManager session initialization', () => {
  it('uses a session override when the profile default differs', async () => {
    const manager = new ModelManager({ defaultModel: 'xopc-cloud/deepseek-v4-flash' });
    const sessionKey = 'agent:coder:tui-test';

    await expect(
      manager.switchModelForSession(sessionKey, 'minimax-cn/MiniMax-M2.7'),
    ).resolves.toBe(true);

    expect(
      manager.resolveInitialModelForSession(
        sessionKey,
        'xopc-cloud/deepseek-v4-flash',
      ),
    ).toBe('minimax-cn/MiniMax-M2.7');
  });

  it('uses the profile default when the session has no override', () => {
    const manager = new ModelManager({ defaultModel: 'openai/gpt-4o' });

    expect(
      manager.resolveInitialModelForSession(
        'agent:coder:tui-new',
        'minimax-cn/MiniMax-M2.7',
      ),
    ).toBe('minimax-cn/MiniMax-M2.7');
  });
  it('keeps a fixed unavailable identity and excludes every fallback candidate', () => {
    const manager = new ModelManager({ defaultModel: 'openai/gpt-4o' });
    manager.setSessionProfileDefault('chat', 'openai/gpt-4o', ['minimax-cn/MiniMax-M2.7']);
    manager.restoreSessionModel('chat', 'xopc-cloud/deepseek-v4-flash', true);
    expect(manager.getModelForSession('chat')).toBe('xopc-cloud/deepseek-v4-flash');
    expect(manager.getFallbackCandidatesForSession('chat')).toEqual([{ provider: 'xopc-cloud', model: 'deepseek-v4-flash' }]);
    expect(() => manager.getResolvedModelForSession('chat')).toThrow('Model not found');
  });

});
