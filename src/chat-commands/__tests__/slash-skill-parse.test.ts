import { describe, it, expect } from 'vitest';
import { parseSlashCommand } from '../command-parse.js';

describe('parseSlashCommand', () => {
  it('does not treat /skill:name as a registered token alone', () => {
    const r = parseSlashCommand('/skill:weather Paris');
    expect(r).toEqual({ command: 'skill:weather', args: 'Paris' });
  });

  it('parses multiline and picks first slash line', () => {
    const r = parseSlashCommand('note\n/help');
    expect(r).toEqual({ command: 'help', args: '' });
  });
});
