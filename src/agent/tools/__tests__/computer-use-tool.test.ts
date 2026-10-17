import { describe, expect, it, vi } from 'vitest';
import { createComputerUseTool } from '../computer-use-tool.js';
import { ComputerOperationError } from '../../../computer/errors.js';

describe('computer tool error signaling', () => {
  const setup = () => {
    const execute = vi.fn(), close = vi.fn(), getReport = vi.fn();
    const tool = createComputerUseTool({ runtime: { execute, close, getReport } as any,
      context: () => ({ conversationId: 'owner', runId: 'run' }) });
    return { execute, close, getReport, tool };
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
  it('attaches only the conversation-scoped runtime report after a failure', async () => {
    const f = setup();
    f.getReport.mockReturnValue({ reportId: 'safe-report', counters: { modelRequests: 1 } });
    f.execute.mockRejectedValue(new Error('private upstream body'));
    const error = await f.tool.execute('call', { op: 'step', goal: 'Private goal' }, undefined, undefined).catch(error => error);
    expect(JSON.parse(error.message)).toMatchObject({ report: { reportId: 'safe-report', counters: { modelRequests: 1 } } });
    expect(error.message).not.toMatch(/upstream|Private goal/);
    expect(f.getReport).toHaveBeenCalledWith('owner');
  });
  it('reads a report without requesting a continuation or closing the session', async () => {
    const f = setup(); f.execute.mockResolvedValue({ status: 'report', sessionId: 's', report: { status: 'active' } });
    await expect(f.tool.execute('call', { op: 'report' }, undefined, undefined)).resolves.toMatchObject({ details: { status: 'report' } });
    expect(f.execute).toHaveBeenCalledOnce(); expect(f.close).not.toHaveBeenCalled();
  });
  it('retains bounded upload diagnostics across the endpoint error transport', async () => {
    const f = setup();
    const diagnostic = { errorCode: 'COMPUTER_FRAME_UPLOAD_HTTP_413', phase: 'frame_upload' as const,
      diagnosticId: crypto.randomUUID(), httpStatus: 413 };
    f.execute.mockRejectedValue(new Error(new ComputerOperationError(diagnostic).message));
    const error = await f.tool.execute('call', { op: 'step', goal: 'Inspect' }, undefined, undefined).catch(error => error);
    expect(JSON.parse(error.message)).toMatchObject({ status: 'error', ...diagnostic });
  });
  it('passes explicit flow save/list/delete operations without starting an action loop', async () => {
    const f = setup(), id = crypto.randomUUID();
    for (const input of [{ op: 'close', saveFlowAs: 'Open memories' }, { op: 'flows' }, { op: 'forget_flow', flowId: id }]) {
      f.execute.mockResolvedValueOnce({ status: 'stopped', sessionId: 's' });
      await f.tool.execute('call', input, undefined, undefined);
      expect(f.execute).toHaveBeenLastCalledWith('owner', input, undefined);
    }
    expect(f.close).not.toHaveBeenCalled();
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
