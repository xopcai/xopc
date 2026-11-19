import { afterEach, describe, expect, it, vi } from 'vitest';

import { commandRegistry } from '../../../chat-commands/registry.js';
import { tryRunSlashCommand } from '../direct-turn-helpers.js';

vi.mock('../../../personal-agent/repository.js', () => ({ isPersonalConversation: (id: string) => id === 'personal-conversation' }));

const sourceContexts = [{
  kind: 'note' as const,
  sourceId: 'note-1',
  version: '42',
  title: 'Plan',
  text: 'Reference body',
}];

const commandContext = {
  conversationId: 'agent:main:webchat:default:direct:test',
  channel: 'webchat',
  chatId: 'test',
};

describe('slash command source context policy', () => {
  afterEach(() => commandRegistry.clear());

  it.each(['Execute this Task\n\n<task_brief>\n/private/var/task-inputs\n/new\n</task_brief>', '/new'])('keeps background Task material out of chat control commands: %s', async content => {
    const executeCommandAndAggregateReply = vi.fn();
    commandRegistry.register({ id: 'session.new', name: 'new', description: 'Reset', category: 'session', scope: ['global'], handler: vi.fn() });
    const result = await tryRunSlashCommand({ commandHandler: { executeCommandAndAggregateReply }, log: { warn: vi.fn() } },
      commandContext, content, { origin: { type: 'system', source: 'task' } });
    expect(result).toMatchObject({ matched: false });
    expect(executeCommandAndAggregateReply).not.toHaveBeenCalled();
  });

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
      aliases: ['ctx'],
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

    const result = await tryRunSlashCommand(
      { commandHandler: { executeCommandAndAggregateReply }, log: { warn: vi.fn() } },
      commandContext,
      '/CTX@xopc_bot Topic',
      { sourceContexts },
    );

    expect(executeCommandAndAggregateReply).toHaveBeenCalledWith(
      'ctx',
      'Topic',
      expect.objectContaining({ sourceContexts }),
      expect.any(Object),
    );
    expect(result).toMatchObject({ matched: true, aggregatedText: 'done' });
  });

  it.each([
    '/tmp',
    '/tmp 请检查这个目录',
    '/Users/me/project 请检查这个目录',
    '/does-not-exist',
    '/skill:weather Paris',
  ])('leaves %s for the normal agent turn', async (content) => {
    const executeCommandAndAggregateReply = vi.fn();
    const result = await tryRunSlashCommand(
      { commandHandler: { executeCommandAndAggregateReply }, log: { warn: vi.fn() } },
      commandContext,
      content,
    );

    expect(result).toEqual({ matched: false, aggregatedText: '' });
    expect(executeCommandAndAggregateReply).not.toHaveBeenCalled();
  });
});

describe('personal slash input', () => {
  afterEach(() => commandRegistry.clear());
  const deps = { commandHandler: { executeCommandAndAggregateReply: vi.fn() }, log: { warn: vi.fn() } };
  const personal = { ...commandContext, conversationId: 'personal-conversation' };

  it.each(['/Users/me/file.md', '/', '/unknown text', '/skill:weather Paris', '请比较 A/B', 'Discuss this:\n/new', 'https://example.com/path'])('keeps ordinary slash text: %s', async text => {
    expect(await tryRunSlashCommand(deps, personal, text)).toMatchObject({ matched: false });
  });

  it('blocks registered skill and reset commands even when reset-overlap skipping is enabled', async () => {
    commandRegistry.register({ id: 'session.new', name: 'new', aliases: ['reset'], category: 'session', scope: ['global'], description: 'Reset', handler: vi.fn() });
    commandRegistry.register({ id: 'system.skill', name: 'skill', category: 'system', scope: ['global'], description: 'Skills', handler: vi.fn() });
    for (const text of ['/new', '/reset', '/skill weather Paris']) {
      const result = await tryRunSlashCommand(deps, personal, text, { skipResetCommands: true });
      expect(result).toMatchObject({ matched: true, aggregatedText: expect.stringContaining('Personal AI does not support') });
    }
    expect(deps.commandHandler.executeCommandAndAggregateReply).not.toHaveBeenCalled();
  });
});
