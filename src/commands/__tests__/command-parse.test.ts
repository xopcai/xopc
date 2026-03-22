import { describe, it, expect } from 'vitest';
import { normalizeTelegramCommandName, parseSlashCommand } from '../command-parse.js';

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

describe('parseSlashCommand', () => {
  it('parses first slash line when transcript precedes caption', () => {
    expect(parseSlashCommand('hello world\n/tts always')).toEqual({
      command: 'tts',
      args: 'always',
    });
  });

  it('returns null when no line starts with /', () => {
    expect(parseSlashCommand('hello /tts')).toBeNull();
  });
});
