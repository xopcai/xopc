import { describe, expect, it } from 'vitest';

import { DELEGATE_BLOCKED_TOOLS, DEFAULT_DELEGATE_TOOLS } from '../delegate-tool.js';

describe('delegate_task allowlist', () => {
  it('default toolset has no blocked tools', () => {
    for (const name of DEFAULT_DELEGATE_TOOLS) {
      expect(DELEGATE_BLOCKED_TOOLS.has(name)).toBe(false);
    }
  });

  it('strips blocked names from a requested toolset', () => {
    const requested = ['read_file', 'delegate_task', 'clarify', 'shell'];
    const allowed = requested.filter((t) => !DELEGATE_BLOCKED_TOOLS.has(t));
    expect(allowed).toEqual(['read_file', 'shell']);
  });
});
