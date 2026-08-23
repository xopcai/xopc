// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  fetchWorkDiscoveryRun: vi.fn(),
  importUnderstandingSources: vi.fn().mockRejectedValue(new Error('Analysis failed')),
  reviewUnderstandingSourceProfile: vi.fn(),
}));

vi.mock('../../user-context/user-context-api', () => ({
  updateUserFocusStatus: vi.fn(),
}));

import type { ElectronAPI } from '@/types/electron';

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
});
