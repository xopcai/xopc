// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  fetchWorkDiscoveryRun: vi.fn(),
  importUnderstandingSources: vi.fn().mockRejectedValue(new Error('Analysis failed')),
  reviewUnderstandingSourceProfile: vi.fn(),
}));

vi.mock('../../user-context/user-context-api', () => ({
  updateUnderstanding: vi.fn(),
  updateUserFocusStatus: vi.fn(),
}));

import type { ElectronAPI } from '@/types/electron';
import { updateUnderstanding } from '@/features/user-context/user-context-api';

import { useUnderstandingActivityStore } from '../understanding-activity-store';

describe('understanding activity store', () => {
  afterEach(() => {
    delete window.electronAPI;
    useUnderstandingActivityStore.getState().finish();
    vi.clearAllMocks();
  });

  it('preserves completed source scans when downstream analysis fails', async () => {
    window.electronAPI = {
      understandingSources: {
        catalog: vi.fn(),
        collect: vi.fn().mockResolvedValue([{
          sourceId: 'local-recent-files',
          status: 'completed',
          items: [{
            id: 'item-1',
            sourceId: 'local-recent-files',
            type: 'document',
            title: 'Project notes',
            ownerAttribution: 'user',
            sensitivity: 'personal',
            evidenceRef: 'local-recent-files://item-1',
          }],
        }]),
      },
    } as unknown as ElectronAPI;

    await useUnderstandingActivityStore.getState().collectSources(undefined, ['local-recent-files']);

    expect(useUnderstandingActivityStore.getState()).toMatchObject({
      status: 'partial',
      sources: { 'local-recent-files': 'completed' },
      itemCounts: { 'local-recent-files': 1 },
      error: 'Analysis failed',
    });
  });

  it('edits and activates a source-derived memory in one review decision', async () => {
    useUnderstandingActivityStore.setState({
      status: 'review_ready',
      memories: [{
        id: 'candidate-1',
        understandingId: 'understanding-1',
        category: 'preference',
        statement: 'Original wording',
        confidence: 'high',
        evidence: ['Observed in project notes'],
        status: 'pending',
      }],
    });

    await useUnderstandingActivityStore.getState().reviewMemory('understanding-1', true, 'Edited wording');

    expect(updateUnderstanding).toHaveBeenCalledWith('understanding-1', {
      statement: 'Edited wording',
      status: 'active',
    });
    expect(useUnderstandingActivityStore.getState().memories[0]).toMatchObject({
      statement: 'Edited wording',
      status: 'edited',
    });
  });

  it('keeps a completed directory run ready for review until the user confirms it', () => {
    useUnderstandingActivityStore.getState().updateDirectoryRun({
      id: 'run-1',
      rootPath: '/workspace',
      status: 'completed',
      projectId: 'project-1',
      sessionKey: 'session-1',
      result: {
        projectSummary: 'A project summary',
        currentState: 'Ready for review',
        uncertainties: [],
        suggestions: [],
      },
    });

    expect(useUnderstandingActivityStore.getState()).toMatchObject({
      status: 'review_ready',
      directoryStatus: 'completed',
      directoryRun: { id: 'run-1' },
    });
  });
});
