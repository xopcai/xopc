// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchLocalSourcePreviews: vi.fn(),
  discoverWorkDiscoveryCandidates: vi.fn(),
  startDeepUnderstandingRun: vi.fn(),
  fetchDeepUnderstandingRun: vi.fn(),
  confirmDeepUnderstandingRun: vi.fn(),
  dismissWorkDiscoveryOnboarding: vi.fn(),
  grantUnderstandingWorkFolder: vi.fn(),
  startWorkDiscoveryRun: vi.fn(),
  fetchWorkDiscoveryRun: vi.fn(),
  fetchConnectorInstances: vi.fn(),
  fetchComposioConnectorCatalog: vi.fn(),
}));

vi.mock('@/features/work-discovery/api', () => ({
  fetchLocalSourcePreviews: mocks.fetchLocalSourcePreviews,
  discoverWorkDiscoveryCandidates: mocks.discoverWorkDiscoveryCandidates,
  startDeepUnderstandingRun: mocks.startDeepUnderstandingRun,
  fetchDeepUnderstandingRun: mocks.fetchDeepUnderstandingRun,
  cancelDeepUnderstandingRun: vi.fn(async () => ({})),
  confirmDeepUnderstandingRun: mocks.confirmDeepUnderstandingRun,
  dismissWorkDiscoveryOnboarding: mocks.dismissWorkDiscoveryOnboarding,
  grantUnderstandingWorkFolder: mocks.grantUnderstandingWorkFolder,
  startWorkDiscoveryRun: mocks.startWorkDiscoveryRun,
  fetchWorkDiscoveryRun: mocks.fetchWorkDiscoveryRun,
  cancelWorkDiscoveryRun: vi.fn(async () => ({})),
  selectWorkDiscoverySuggestion: vi.fn(async () => {}),
  submitWorkDiscoveryRecognitionFeedback: vi.fn(async () => ({})),
}));

vi.mock('@/features/connectors/connectors-api', () => ({
  fetchConnectorInstances: mocks.fetchConnectorInstances,
  fetchComposioConnectorCatalog: mocks.fetchComposioConnectorCatalog,
}));

vi.mock('@/features/connectors/components/install-connector-dialog', () => ({
  InstallConnectorDialog: () => null,
}));

vi.mock('@/features/fs/use-directory-picker', () => ({
  useDirectoryPicker: () => ({
    hasNativePicker: false,
    modalOpen: false,
    setModalOpen: vi.fn(),
    pick: vi.fn(),
    confirmPick: vi.fn(async () => {}),
    picking: false,
  }),
}));

vi.mock('@/features/fs/working-directory-picker-modal', () => ({
  WorkingDirectoryPickerModal: () => null,
}));

vi.mock('@/stores/locale-store', () => ({
  useLocaleStore: (selector: (state: { language: 'en'; setLanguage: () => void }) => unknown) =>
    selector({ language: 'en', setLanguage: vi.fn() }),
}));

import { useUnderstandingActivityStore } from '@/features/work-discovery/understanding-activity-store';
import { DeepUnderstandingOnboarding } from '../deep-understanding-onboarding';

describe('DeepUnderstandingOnboarding (Step 2 About You + Step 3 Workspace Project)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    mocks.fetchLocalSourcePreviews.mockResolvedValue({
      platform: 'darwin',
      previews: [
        { sourceId: 'local-ai-instructions', detected: true, itemCount: 2, summary: 'Claude' },
        { sourceId: 'local-obsidian', detected: true, itemCount: 30, summary: 'Knowledge' },
        { sourceId: 'local-markdown-notes', detected: false, itemCount: 0 },
        { sourceId: 'local-recent-files', detected: true, itemCount: 12 },
        { sourceId: 'chromium-bookmarks', detected: false, itemCount: 0 },
      ],
    });
    mocks.discoverWorkDiscoveryCandidates.mockResolvedValue({
      candidates: [
        {
          id: 'cand-xopc',
          rootPath: '/Users/demo/develop/xopc',
          displayName: 'xopc',
          source: 'ai_tool_project',
          projectKind: 'coding',
          projectKindConfidence: 0.95,
          score: 96,
          branch: 'main',
          changedFileCount: 3,
          evidence: ['git repo'],
        },
      ],
      recentFiles: [],
      processingTarget: { provider: 'openai', remoteModel: true },
    });
    mocks.fetchConnectorInstances.mockResolvedValue([]);
    mocks.fetchComposioConnectorCatalog.mockResolvedValue({ connectors: [] });
    mocks.dismissWorkDiscoveryOnboarding.mockResolvedValue(undefined);
    mocks.confirmDeepUnderstandingRun.mockResolvedValue({
      ok: true,
      confirmedAssertionIds: ['a1'],
      createdRuleIds: ['r1'],
    });
    mocks.grantUnderstandingWorkFolder.mockResolvedValue({ id: 'grant-1' });
    mocks.startWorkDiscoveryRun.mockResolvedValue({
      id: 'proj-run-1',
      status: 'analyzing',
      stage: 'folder_structure',
      rootPath: '/Users/demo/develop/xopc',
      projectId: 'proj-1',
      conversationId: 'conv-1',
    });
    mocks.fetchWorkDiscoveryRun.mockResolvedValue({
      id: 'proj-run-1',
      status: 'analyzing',
      stage: 'recent_progress',
      rootPath: '/Users/demo/develop/xopc',
      projectId: 'proj-1',
      conversationId: 'conv-1',
    });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    delete window.electronAPI;
    useUnderstandingActivityStore.getState().finish();
    vi.clearAllMocks();
  });

  it('hides undetected local sources, shows cloud connectors, runs Step 2 Reveal, and transitions to Step 3 project creation', async () => {
    const runningRun = {
      id: 'run-deep-1',
      status: 'running' as const,
      phase: 'analyzing_writing' as const,
      selectedSources: ['local-ai-instructions', 'local-obsidian', 'local-recent-files'],
      sourceStatuses: [
        { sourceId: 'local-ai-instructions', status: 'completed' as const, itemCount: 2 },
        { sourceId: 'local-obsidian', status: 'completed' as const, itemCount: 30 },
        { sourceId: 'local-recent-files', status: 'completed' as const, itemCount: 12 },
      ],
      startedAt: Date.now(),
    };
    const completedRun = {
      ...runningRun,
      status: 'completed' as const,
      phase: 'completed' as const,
      completedAt: Date.now(),
      result: {
        aboutYou: [
          {
            id: 'about-1',
            assertionId: 'a1',
            category: 'role' as const,
            domain: 'identity',
            factKey: 'role:builder',
            statement: 'Builds local-first AI desktop tools',
            confidence: 'high' as const,
            evidence: ['Obsidian & CLAUDE.md'],
            sourceIds: ['local-obsidian', 'local-ai-instructions'],
            independentSourceCount: 2,
            status: 'pending' as const,
          },
        ],
        writingPreferences: [
          {
            id: 'w-1',
            assertionId: 'aw1',
            dimension: 'structure' as const,
            factKey: 'writing:structure',
            statement: 'Lead with conclusions and compact tables',
            confidence: 'high' as const,
            evidence: ['CLAUDE.md'],
            evidenceRefs: ['local-ai-instructions://r1'],
            sourceIds: ['local-ai-instructions'],
            status: 'pending' as const,
          },
        ],
        workThreads: [],
        calibrationQuestions: [],
        sampledCounts: { 'local-obsidian': 30 },
        sourceStatuses: [{ sourceId: 'local-obsidian', status: 'completed' as const }],
      },
    };
    mocks.startDeepUnderstandingRun.mockResolvedValue(runningRun);
    mocks.fetchDeepUnderstandingRun.mockResolvedValue(completedRun);

    const onRequestClose = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DeepUnderstandingOnboarding onRequestClose={onRequestClose} />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    // Only detected local sources + cloud connectors appear (no noisy undetected Bookmarks card).
    expect(container.textContent).toContain('Obsidian');
    expect(container.textContent).toContain('AI Rules');
    expect(container.textContent).toContain('Gmail');
    expect(container.textContent).not.toContain('Bookmarks');

    // Start Step 2 deep understanding.
    const startButton = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Start learning'))!;
    await act(async () => {
      startButton.click();
      await Promise.resolve();
    });
    expect(mocks.startDeepUnderstandingRun).toHaveBeenCalledOnce();

    // Deliver completion event to view Reveal.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('understanding-completed', {
        detail: { runId: completedRun.id, run: completedRun },
      }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Builds local-first AI desktop tools');
    expect(container.textContent).toContain('Lead with conclusions and compact tables');

    // Save & advance to Step 3 (Workspace Project setup).
    const saveNextButton = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Save & set up workspace'))!;
    await act(async () => {
      saveNextButton.click();
      await Promise.resolve();
    });

    expect(mocks.confirmDeepUnderstandingRun).toHaveBeenCalledWith(
      completedRun.id,
      expect.objectContaining({ markOnboardingCompleted: false }),
    );
    expect(container.textContent).toContain('Set up a workspace');
    expect(container.textContent).toContain('xopc');

    // Create project & start understanding for the selected folder.
    const createProjectBtn = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Create project & analyze'))!;
    await act(async () => {
      createProjectBtn.click();
      await Promise.resolve();
    });

    expect(mocks.grantUnderstandingWorkFolder).toHaveBeenCalledWith('/Users/demo/develop/xopc', 'remote_allowed');
    expect(mocks.startWorkDiscoveryRun).toHaveBeenCalledWith('/Users/demo/develop/xopc');

    // Allow continuing in background straight into the workspace.
    const bgBtn = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Continue in background'))!;
    await act(async () => {
      bgBtn.click();
      await Promise.resolve();
    });
    expect(onRequestClose).toHaveBeenCalledOnce();
  });

  it('adapts local source presentation for Windows/Linux without Apple sources and surfaces custom Obsidian/notes action', async () => {
    mocks.fetchLocalSourcePreviews.mockResolvedValue({
      platform: 'win32',
      previews: [
        { sourceId: 'local-ai-instructions', detected: false, itemCount: 0 },
        { sourceId: 'local-obsidian', detected: false, itemCount: 0 },
        { sourceId: 'local-markdown-notes', detected: false, itemCount: 0 },
        { sourceId: 'local-recent-files', detected: true, itemCount: 15 },
        { sourceId: 'chromium-bookmarks', detected: false, itemCount: 0 },
      ],
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <DeepUnderstandingOnboarding onRequestClose={vi.fn()} />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Documents · OneDrive · 15');
    expect(container.textContent).toContain('Add local notes or Obsidian vault (OneDrive / custom drive)');
    expect(container.textContent).not.toContain('Apple');
  });
});
