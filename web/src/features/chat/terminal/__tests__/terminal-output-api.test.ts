import { describe, expect, it } from 'vitest';

import { prepareTerminalOutput } from '@/features/chat/terminal/terminal-output-api';

describe('prepareTerminalOutput', () => {
  it('removes terminal control sequences and normalizes newlines', () => {
    expect(prepareTerminalOutput('\u001b[32mready\u001b[0m\r\nnext\rline').output)
      .toBe('ready\nnext\nline');
  });

  it('keeps the latest bounded output and reports truncation', () => {
    expect(prepareTerminalOutput('0123456789', 4)).toEqual({
      output: '6789',
      truncated: true,
    });
  });
});
