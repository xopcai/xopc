import { describe, expect, it } from 'vitest';

import { StreamAssembler } from '../stream-assembler.js';

describe('StreamAssembler thinking display', () => {
  it('shows a compact thinking placeholder when thinking is hidden', () => {
    const assembler = new StreamAssembler();
    expect(assembler.ingestThinking('run-1', 'private chain', false, false)).toBe(
      '<thinking>\nThinking...\n</thinking>\n\n',
    );
    expect(assembler.ingestToken('run-1', 'answer', false)).toBe(
      '<thinking>\nThinking...\n</thinking>\n\nanswer',
    );
  });

  it('recomputes active display text when thinking visibility changes', () => {
    const assembler = new StreamAssembler();
    assembler.ingestThinking('run-1', 'private chain', false, false);
    assembler.ingestToken('run-1', 'answer', false);

    expect(assembler.getDisplayText('run-1', true)).toBe(
      '<thinking>\nprivate chain\n</thinking>\n\nanswer',
    );
    expect(assembler.getDisplayText('run-1', false)).toBe(
      '<thinking>\nThinking...\n</thinking>\n\nanswer',
    );
  });
});
