import { describe, expect, it } from 'vitest';
import { isComputerLeaseTool } from '../control-guard.js';

describe('desktop lease tool admission', () => {
  it('permits desktop control, clarification and static manuals only', () => {
    for (const name of ['computer_use', 'clarify', 'tool_manual']) expect(isComputerLeaseTool(name)).toBe(true);
    for (const name of ['browser_use', 'exec', 'read_file', 'write_file', 'server__computer_use', 'server__tool_manual']) expect(isComputerLeaseTool(name)).toBe(false);
  });
});
