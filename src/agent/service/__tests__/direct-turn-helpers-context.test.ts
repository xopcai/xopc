import { afterEach, describe, expect, it, vi } from 'vitest';

import { commandRegistry } from '../../../chat-commands/registry.js';
import { tryRunSlashCommand } from '../direct-turn-helpers.js';

const sourceContexts = [{
  kind: 'note' as const,
  sourceId: 'note-1',
  version: '42',
  title: 'Plan',
  text: 'Reference body',
}];

const commandContext = {
  sessionKey: 'agent:main:webchat:default:direct:test',
  channel: 'webchat',
  chatId: 'test',
};

describe('slash command source context policy', () => {
  afterEach(() => commandRegistry.clear());

  it('returns an explicit receipt instead of silently dropping unsupported context', async () => {
    commandRegistry.register({
      id: 'test.plain',
      name: 'plain',
      description: 'Plain command',
      category: 'system',
      scope: ['private'],
      handler: vi.fn(),
    });
    const executeCommandAndAggregateReply = vi.fn();

    const result = await tryRunSlashCommand(
      { commandHandler: { executeCommandAndAggregateReply }, log: { warn: vi.fn() } },
      commandContext,
      '/plain',
      { sourceContexts },
    );

    expect(result.matched).toBe(true);
    expect(result.aggregatedText).toContain('does not accept Note context');
    expect(executeCommandAndAggregateReply).not.toHaveBeenCalled();
  });

  it('passes frozen context to an opted-in command', async () => {
    commandRegistry.register({
      id: 'test.contextual',
      name: 'contextual',
      description: 'Context-aware command',
      category: 'tool',
      scope: ['private'],
      acceptsContext: true,
      handler: vi.fn(),
    });
    const executeCommandAndAggregateReply = vi.fn(async () => ({
      handled: true,
      aggregatedText: 'done',
    }));

    await tryRunSlashCommand(
      { commandHandler: { executeCommandAndAggregateReply }, log: { warn: vi.fn() } },
      commandContext,
      '/contextual',
      { sourceContexts },
    );

    expect(executeCommandAndAggregateReply).toHaveBeenCalledWith(
      'contextual',
      '',
      expect.objectContaining({ sourceContexts }),
      expect.any(Object),
    );
  });
});
