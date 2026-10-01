import { describe, expect, it, vi } from 'vitest';
import { createComputerUseTool } from '../computer-use-tool.js';
import { ComputerOperationError } from '../../../computer/errors.js';

describe('computer tool error signaling', () => {
  const setup = () => {
    const execute = vi.fn(), close = vi.fn();
    const tool = createComputerUseTool({ runtime: { execute, close } as any,
      context: () => ({ conversationId: 'owner', runId: 'run' }) });
    return { execute, close, tool };
  };
  it('throws structured failures because pi ignores returned isError flags', async () => {
    const f = setup();
    f.execute.mockResolvedValue({ status: 'stopped', errorCode: 'COMPUTER_WINDOW_AMBIGUOUS',
      windows: [{ windowRef: 'ref', title: 'Project', visible: true }], nextAction: 'Select a window' });
    const error = await f.tool.execute('call', { op: 'discover', query: 'Example' }, undefined, undefined).catch(error => error);
    expect(JSON.parse(error.message)).toMatchObject({ errorCode: 'COMPUTER_WINDOW_AMBIGUOUS', windows: [{ title: 'Project' }] });
  });
  it('resumes a held action without a chat continuation prompt', async () => {
    const f = setup();
    f.execute.mockResolvedValueOnce({ status: 'pending_action', pending: true, sessionId: 's' })
      .mockResolvedValueOnce({ status: 'ready', sessionId: 's', receipt: { dispatch: 'completed' } });
    await expect(f.tool.execute('call', { op: 'step', goal: 'Click' }, undefined, undefined)).resolves.toMatchObject({ details: { status: 'ready' } });
    expect(f.execute).toHaveBeenLastCalledWith('owner', { op: 'step', goal: 'Click' }, undefined);
    expect(f.close).not.toHaveBeenCalled();
  });
  it('waits for settings authorization to finish without a chat clarification', async () => {
    const f = setup();
    f.execute.mockResolvedValueOnce({ status: 'pending_authorization', pending: true, sessionId: 's' })
      .mockResolvedValueOnce({ status: 'ready', sessionId: 's', summary: 'Notes window' });
    await expect(f.tool.execute('call', { op: 'open', appRef: 'app', mode: 'observe', prepare: false }, undefined, undefined))
      .resolves.toMatchObject({ details: { status: 'ready', summary: 'Notes window' } });
    expect(f.execute).toHaveBeenLastCalledWith('owner', { op: 'observe' }, undefined);
  });
  it('does not echo raw host errors, keys or exception payloads', async () => {
    const f = setup(); f.execute.mockRejectedValue(new Error('private upstream response'));
    await expect(f.tool.execute('call', { op: 'discover', query: '' }, undefined, undefined)).rejects.toThrow('COMPUTER_OPERATION_FAILED');
  });
  it('retains bounded upload diagnostics across the endpoint error transport', async () => {
    const f = setup();
    const diagnostic = { errorCode: 'COMPUTER_FRAME_UPLOAD_HTTP_413', phase: 'frame_upload' as const,
      diagnosticId: crypto.randomUUID(), httpStatus: 413 };
    f.execute.mockRejectedValue(new Error(new ComputerOperationError(diagnostic).message));
    const error = await f.tool.execute('call', { op: 'step', goal: 'Inspect' }, undefined, undefined).catch(error => error);
    expect(JSON.parse(error.message)).toMatchObject({ status: 'error', ...diagnostic });
  });
  it('exposes no legacy bundle-ID or raw action schema', () => {
    const { tool } = setup();
    expect(Object.keys((tool.parameters as any).properties)).not.toEqual(expect.arrayContaining(['appId', 'action']));
    expect(tool.description).not.toContain('user supplied bundle ID');
  });
  it('retains model diagnostics and gives request-specific recovery guidance', async () => {
    const f = setup();
    const diagnostic = { errorCode: 'COMPUTER_MODEL_HTTP_400', phase: 'model' as const,
      diagnosticId: crypto.randomUUID(), requestId: crypto.randomUUID(), httpStatus: 400,
      serviceErrorCode: 'max_input_tokens_exceeded' as const };
    f.execute.mockRejectedValue(new ComputerOperationError(diagnostic));
    const error = await f.tool.execute('call', { op: 'observe', question: 'Describe' }, undefined, undefined).catch(error => error);
    expect(JSON.parse(error.message)).toMatchObject({ status: 'error', ...diagnostic, nextAction: expect.stringContaining('input/output limits') });
  });
});
