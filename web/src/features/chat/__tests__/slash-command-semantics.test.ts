import { describe, expect, it } from 'vitest';

import {
  isBareResetCommand,
  isTaskDestructiveCommand,
  parseLeadingSlashCommand,
} from '@/features/chat/session/slash-command-semantics';

describe('slash command semantics', () => {
  it.each(['/new', '/RESET', '/restart', '  /New  '])('recognizes bare reset command %s', (value) => {
    expect(isBareResetCommand(value)).toBe(true);
  });

  it('does not consume reset commands that carry a follow-up prompt', () => {
    expect(isBareResetCommand('/new continue with auth')).toBe(false);
  });

  it.each(['/new prompt', '/reset', '/RESTART', '/clear', '/archive'])('blocks destructive task command %s', (value) => {
    expect(isTaskDestructiveCommand(value)).toBe(true);
  });

  it('parses bot-addressed commands case-insensitively', () => {
    expect(parseLeadingSlashCommand('/RESET@xopc_bot')).toEqual({ name: 'reset', args: '' });
  });
});
