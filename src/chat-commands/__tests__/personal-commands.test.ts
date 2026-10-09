import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandRegistry } from '../registry.js';
import type { CommandContext } from '../types.js';

vi.mock('../../personal-agent/repository.js', () => ({
  isPersonalConversation: (id: string) => id === 'personal-conversation',
}));

const context = (conversationId: string) => ({ conversationId, isGroup: false }) as CommandContext;

describe('Personal AI commands', () => {
  let registry: CommandRegistry;
  beforeEach(() => { registry = new CommandRegistry(); });

  it.each(['new', 'clear', 'archive', 'model', 'skill', 'workflow'])('blocks /%s before its handler runs, including aliases', async name => {
    const handler = vi.fn();
    registry.register({ id: `test.${name}`, name, aliases: ['alias'], category: 'system', scope: ['global'], description: name, handler });
    for (const command of [name, 'alias']) {
      expect(await registry.execute(command, context('personal-conversation'))).toMatchObject({ success: false, content: expect.stringContaining('Personal AI does not support') });
    }
    expect(handler).not.toHaveBeenCalled();
    await registry.execute(name, context('ordinary-conversation'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('preserves reply cancellation and its aliases', async () => {
    const handler = vi.fn(async () => ({ content: 'Stopped', success: true }));
    registry.register({ id: 'session.abort', name: 'abort', aliases: ['stop', 'cancel'], category: 'session', scope: ['global'], description: 'Stop', handler });
    for (const name of ['abort', 'stop', 'cancel']) {
      expect(await registry.execute(name, context('personal-conversation'))).toMatchObject({ success: true });
    }
    expect(handler).toHaveBeenCalledTimes(3);
  });
});
