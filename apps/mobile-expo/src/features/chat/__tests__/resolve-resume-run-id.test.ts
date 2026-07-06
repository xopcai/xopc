import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../query/sessions', () => ({
  fetchSessionActiveRun: vi.fn(),
}));

vi.mock('../../gateway/pending-agent-run', () => ({
  readPendingAgentRunId: vi.fn(),
  setPendingAgentRun: vi.fn(),
}));

import { fetchSessionActiveRun } from '../../../query/sessions';
import {
  readPendingAgentRunId,
  setPendingAgentRun,
} from '../../gateway/pending-agent-run';
import { resolveResumeRunId } from '../resolve-resume-run-id';

const mockedFetchSessionActiveRun = vi.mocked(fetchSessionActiveRun);
const mockedReadPendingAgentRunId = vi.mocked(readPendingAgentRunId);
const mockedSetPendingAgentRun = vi.mocked(setPendingAgentRun);

describe('resolveResumeRunId', () => {
  beforeEach(() => {
    mockedFetchSessionActiveRun.mockReset();
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

  it('falls back to local pending run when the gateway has no active run', async () => {
    mockedFetchSessionActiveRun.mockResolvedValueOnce({ active: false });
    mockedReadPendingAgentRunId.mockReturnValueOnce('run-local');

    await expect(resolveResumeRunId('session-a')).resolves.toBe('run-local');

    expect(mockedReadPendingAgentRunId).toHaveBeenCalledWith('session-a');
  });

  it('falls back to local pending run when the gateway request fails', async () => {
    mockedFetchSessionActiveRun.mockRejectedValueOnce(new Error('Network request failed'));
    mockedReadPendingAgentRunId.mockReturnValueOnce('run-local');

    await expect(resolveResumeRunId('session-a')).resolves.toBe('run-local');
  });
});
