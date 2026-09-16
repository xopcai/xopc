import { describe, expect, it, vi } from 'vitest';
import { createComputerUseTool } from '../computer-use-tool.js';

describe('computer tool error signaling', () => {
  const setup = () => {
    const execute = vi.fn(), close = vi.fn();
    const tool = createComputerUseTool({ runtime: { execute, close } as any,
      context: () => ({ conversationId: 'owner', runId: 'run' }), requestClarification: vi.fn() });
    return { execute, tool };
  };
  it('throws structured failures because pi ignores returned isError flags', async () => {
    const f = setup();
    f.execute.mockResolvedValue({ status: 'stopped', errorCode: 'COMPUTER_WINDOW_AMBIGUOUS',
      windows: [{ windowRef: 'ref', title: 'Project', visible: true }], nextAction: 'Select a window' });
    const error = await f.tool.execute('call', { op: 'discover', query: 'Example' }, undefined, undefined).catch(error => error);
    expect(JSON.parse(error.message)).toMatchObject({ errorCode: 'COMPUTER_WINDOW_AMBIGUOUS', windows: [{ title: 'Project' }] });
  });
  it('does not echo raw host errors, keys or exception payloads', async () => {
    const f = setup(); f.execute.mockRejectedValue(new Error('private upstream response'));
    await expect(f.tool.execute('call', { op: 'discover', query: '' }, undefined, undefined)).rejects.toThrow('COMPUTER_OPERATION_FAILED');
  });
  it('exposes no legacy bundle-ID or raw action schema', () => {
    const { tool } = setup();
    expect(Object.keys((tool.parameters as any).properties)).not.toEqual(expect.arrayContaining(['appId', 'action']));
    expect(tool.description).not.toContain('user supplied bundle ID');
  });
});
