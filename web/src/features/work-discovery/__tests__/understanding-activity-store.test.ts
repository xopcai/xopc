// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { useUnderstandingActivityStore } from '../understanding-activity-store';

describe('understanding activity store', () => {
  afterEach(() => {
    useUnderstandingActivityStore.getState().finish();
  });

  it('tracks deep understanding run progress, item counts, and partial failures', () => {
    useUnderstandingActivityStore.getState().updateDeepRun({
      id: 'deep-run-1',
      status: 'running',
      phase: 'analyzing_writing',
      selectedSources: ['local-obsidian', 'apple-notes'],
      sourceStatuses: [
        { sourceId: 'local-obsidian', status: 'completed', itemCount: 24 },
        { sourceId: 'apple-notes', status: 'collecting', itemCount: 0 },
      ],
      startedAt: 1_000,
    });

    expect(useUnderstandingActivityStore.getState()).toMatchObject({
      status: 'running',
      sources: { 'local-obsidian': 'completed', 'apple-notes': 'running' },
      itemCounts: { 'local-obsidian': 24, 'apple-notes': 0 },
    });

    useUnderstandingActivityStore.getState().updateDeepRun({
      id: 'deep-run-1',
      status: 'completed',
      phase: 'completed',
      selectedSources: ['local-obsidian', 'apple-notes'],
      sourceStatuses: [
        { sourceId: 'local-obsidian', status: 'completed', itemCount: 24 },
        { sourceId: 'apple-notes', status: 'denied', itemCount: 0 },
      ],
      startedAt: 1_000,
      completedAt: 4_000,
      result: {
        aboutYou: [],
        writingPreferences: [],
        workThreads: [],
        calibrationQuestions: [],
        sampledCounts: { 'local-obsidian': 24 },
        sourceStatuses: [{ sourceId: 'local-obsidian', status: 'completed' }],
      },
    });

    expect(useUnderstandingActivityStore.getState()).toMatchObject({
      status: 'partial',
      sources: { 'local-obsidian': 'completed', 'apple-notes': 'denied' },
    });
  });

  it('completes directory understanding without a memory approval queue', () => {
    useUnderstandingActivityStore.getState().updateDirectoryRun({
      id: 'run-1',
      rootPath: '/workspace',
      status: 'completed',
      projectId: 'project-1',
      conversationId: 'session-1',
      result: {
        projectSummary: 'A project summary',
        currentState: 'Ready for review',
        uncertainties: [],
        suggestions: [],
      },
    });

    expect(useUnderstandingActivityStore.getState()).toMatchObject({
      status: 'completed',
      directoryStatus: 'completed',
      directoryRun: { id: 'run-1' },
    });
  });
});
