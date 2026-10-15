import { describe, expect, it } from 'vitest';

import { withPersonalPerformance } from '../personal-performance.js';
import { personalPerformanceSnapshot } from '../../../personal-agent/performance.js';

describe('Personal tool measurements', () => {
  it('records returned failures and thrown failures without storing arguments or result content', async () => {
    const tool = { name: 'exec_command', label: 'Run', parameters: {} as never, description: '',
      execute: async () => ({ content: [{ type: 'text' as const, text: 'private file body' }], details: { status: 'blocked' } }) };
    await withPersonalPerformance(tool, 'diagnostic-chat', 'diagnostic-task').execute('failure-return', { cmd: 'private command' });
    const throwing = { ...tool, execute: async () => { throw new Error('private failure'); } };
    await expect(withPersonalPerformance(throwing).execute('failure-throw', {})).rejects.toThrow('private failure');
    const rows = personalPerformanceSnapshot().filter(row => row.toolCallId?.startsWith('failure-'));
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.status === 'error')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('private');
  });
  it('keeps preparing reads out of hot-read latency and does not add a tool execution', async () => {
    let calls = 0;
    const tool = { name: 'personal_result', label: 'Read', parameters: {} as never, description: '',
      execute: async () => { calls++; return { content: [{ type: 'text' as const, text: '{"status":"preparing"}' }], details: {} }; } };
    await withPersonalPerformance(tool).execute('cold-read-measurement', { command: 'read' });
    expect(calls).toBe(1);
    expect(personalPerformanceSnapshot().filter(row => row.toolCallId === 'cold-read-measurement'))
      .toEqual([expect.objectContaining({ phase: 'tool', status: 'pending' })]);
  });
});
