import { describe, expect, it } from 'vitest';

import { DELEGATE_BLOCKED_TOOLS, DEFAULT_DELEGATE_TOOLS, delegateToolNames } from '../delegate-tool.js';

describe('delegate_task allowlist', () => {
  it('default toolset has no blocked tools', () => {
    for (const name of DEFAULT_DELEGATE_TOOLS) {
      expect(DELEGATE_BLOCKED_TOOLS.has(name)).toBe(false);
    }
  });

  it('cannot grant write or shell tools to an independent reviewer', () => {
    expect(delegateToolNames('review', ['exec_command', 'apply_patch', 'read_file', 'delegate_task'])).toEqual(['read_file']);
    expect(delegateToolNames('implement', ['exec_command', 'delegate_task', 'managed_job', 'unknown'])).toEqual(['exec_command']);
  });

  it('strips blocked names from a requested toolset', () => {
    const requested = ['read_file', 'delegate_task', 'clarify', 'exec_command'];
    const allowed = requested.filter((t) => !DELEGATE_BLOCKED_TOOLS.has(t));
    expect(allowed).toEqual(['read_file', 'exec_command']);
  });
});
