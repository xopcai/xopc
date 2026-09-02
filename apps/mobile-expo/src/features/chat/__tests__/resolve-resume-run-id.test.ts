import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../query/sessions', () => ({
  fetchSessionActiveRun: vi.fn(),
}));

vi.mock('../../gateway/pending-agent-run', () => ({
  clearPendingAgentRun: vi.fn(),
  readPendingAgentRunId: vi.fn(),
  setPendingAgentRun: vi.fn(),
}));

import { fetchSessionActiveRun } from '../../../query/sessions';
import {
  clearPendingAgentRun,
  readPendingAgentRunId,
  setPendingAgentRun,
} from '../../gateway/pending-agent-run';
import { resolveResumeRunId } from '../resolve-resume-run-id';

const mockedFetchSessionActiveRun = vi.mocked(fetchSessionActiveRun);
const mockedClearPendingAgentRun = vi.mocked(clearPendingAgentRun);
const mockedReadPendingAgentRunId = vi.mocked(readPendingAgentRunId);
const mockedSetPendingAgentRun = vi.mocked(setPendingAgentRun);

describe('resolveResumeRunId', () => {
  beforeEach(() => {
    mockedFetchSessionActiveRun.mockReset();
    mockedClearPendingAgentRun.mockReset();
    mockedReadPendingAgentRunId.mockReset();
    mockedSetPendingAgentRun.mockReset();
  });

  it('uses the gateway active run and syncs local pending run storage', async () => {
    mockedFetchSessionActiveRun.mockResolvedValueOnce({ active: true, runId: 'run-remote' });

    await expect(resolveResumeRunId(' session-a ')).resolves.toBe('run-remote');

    expect(mockedFetchSessionActiveRun).toHaveBeenCalledWith('session-a');
    expect(mockedSetPendingAgentRun).toHaveBeenCalledWith('session-a', 'run-remote');
    expect(mockedReadPendingAgentRunId).not.toHaveBeenCalled();
  });

  it('clears stale local state when the gateway confirms there is no active run', async () => {
    mockedFetchSessionActiveRun.mockResolvedValueOnce({ active: false });

    await expect(resolveResumeRunId('session-a')).resolves.toBeNull();

    expect(mockedClearPendingAgentRun).toHaveBeenCalledWith('session-a');
    expect(mockedReadPendingAgentRunId).not.toHaveBeenCalled();
  });

  it('falls back to local pending run when the gateway request fails', async () => {
    mockedFetchSessionActiveRun.mockRejectedValueOnce(new Error('Network request failed'));
    mockedReadPendingAgentRunId.mockReturnValueOnce('run-local');

    await expect(resolveResumeRunId('session-a')).resolves.toBe('run-local');
  });

  it('preserves a lookup failure when there is no local run to resume', async () => {
    mockedFetchSessionActiveRun.mockRejectedValueOnce(new Error('Could not reach gateway'));
    mockedReadPendingAgentRunId.mockReturnValueOnce(null);

    await expect(resolveResumeRunId('session-a')).rejects.toThrow('Could not reach gateway');
  });
});
