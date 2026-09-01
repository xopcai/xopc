import { describe, expect, it } from 'vitest';

import {
  consumeTurnMemoryProvenance,
  markTurnToolResult,
  resolveMemorySessionKind,
} from '../turn-provenance.js';

describe('turn memory provenance', () => {
  it('keeps a tool-free interactive turn agent-trusted', () => {
    expect(consumeTurnMemoryProvenance('agent:main:main', 'turn-clean')).toMatchObject({
      originClass: 'agent',
      sessionKind: 'interactive',
      derivedFromRecalledContext: false,
      taintReasons: [],
    });
  });

  it('taints tool-assisted turns and identifies recalled context', () => {
    markTurnToolResult('agent:main:main', 'turn-tool', 'exec_command');
    markTurnToolResult('agent:main:main', 'turn-tool', 'memory_search');

    expect(consumeTurnMemoryProvenance('agent:main:main', 'turn-tool')).toMatchObject({
      originClass: 'untrusted',
      derivedFromRecalledContext: true,
      taintReasons: ['tool:exec_command', 'tool:memory_search'],
    });
  });

  it('classifies non-interactive session kinds structurally', () => {
    expect(resolveMemorySessionKind('agent:main:cron:daily-review')).toBe('automation');
    expect(resolveMemorySessionKind('agent:main:subagent:main')).toBe('subagent');
    expect(resolveMemorySessionKind('agent:main:telegram:group:team')).toBe('group');
  });
});
