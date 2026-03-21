import { describe, it, expect } from 'vitest';
import { normalizeTelegramCommandName } from '../command-parse.js';

describe('normalizeTelegramCommandName', () => {
  it('strips @bot suffix', () => {
    expect(normalizeTelegramCommandName('new@my_bot')).toBe('new');
    expect(normalizeTelegramCommandName('usage@SomeBot')).toBe('usage');
  });

  it('leaves commands without @ unchanged', () => {
    expect(normalizeTelegramCommandName('new')).toBe('new');
    expect(normalizeTelegramCommandName('help')).toBe('help');
  });
});
