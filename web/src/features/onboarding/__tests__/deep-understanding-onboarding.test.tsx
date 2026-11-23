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
}));

vi.mock('@/features/work-discovery/api', () => ({
  fetchLocalSourcePreviews: mocks.fetchLocalSourcePreviews,
  discoverWorkDiscoveryCandidates: mocks.discoverWorkDiscoveryCandidates,
  startDeepUnderstandingRun: mocks.startDeepUnderstandingRun,
  fetchDeepUnderstandingRun: mocks.fetchDeepUnderstandingRun,
  cancelDeepUnderstandingRun: vi.fn(async () => ({})),
  confirmDeepUnderstandingRun: mocks.confirmDeepUnderstandingRun,
  dismissWorkDiscoveryOnboarding: mocks.dismissWorkDiscoveryOnboarding,
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

import { DeepUnderstandingOnboarding } from '../deep-understanding-onboarding';

describe('DeepUnderstandingOnboarding', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    mocks.fetchLocalSourcePreviews.mockResolvedValue([
      { sourceId: 'local-ai-instructions', detected: true, itemCount: 2, summary: 'Claude' },
      { sourceId: 'local-obsidian', detected: true, itemCount: 30, summary: 'Knowledge' },
      { sourceId: 'local-markdown-notes', detected: false, itemCount: 0 },
      { sourceId: 'local-recent-files', detected: true, itemCount: 12 },
      { sourceId: 'chromium-bookmarks', detected: false, itemCount: 0 },
    ]);
    mocks.discoverWorkDiscoveryCandidates.mockResolvedValue({
      candidates: [],
      recentFiles: [],
      processingTarget: { provider: 'openai', remoteModel: true },
    });
    mocks.dismissWorkDiscoveryOnboarding.mockResolvedValue(undefined);
    mocks.confirmDeepUnderstandingRun.mockResolvedValue({
      ok: true,
      confirmedAssertionIds: ['a1'],
      createdRuleIds: ['r1'],
    });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    delete window.electronAPI;
    vi.clearAllMocks();
  });

  it('renders detected Tier 1 sources, runs deep understanding, and confirms writing style & insights in Act 3', async () => {
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
        workThreads: [
          {
            id: 't-1',
            canonicalKey: 'work-thread:onboarding',
            title: 'Ship Deep-Understanding Onboarding',
            summary: 'Unify Tier 1/2 sources and Stage B synthesis.',
            status: 'active' as const,
            horizon: 'current' as const,
            focusScore: 0.9,
            confidence: 0.9,
            userStatus: 'unreviewed' as const,
            projectIds: [],
            evidenceIds: ['local-obsidian://n1'],
            sourceIds: ['local-obsidian'],
          },
        ],
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

    expect(container.textContent).toContain('Obsidian Vaults');
    expect(container.textContent).toContain('AI Rules');

    // Click primary CTA to start Act 2.
    const startButton = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Deeply understand me'))!;
    await act(async () => {
      startButton.click();
      await Promise.resolve();
    });
    expect(mocks.startDeepUnderstandingRun).toHaveBeenCalledOnce();

    // Deliver realtime completion event to enter Act 3 Reveal.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('understanding-completed', {
        detail: { runId: completedRun.id, run: completedRun },
      }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Builds local-first AI desktop tools');
    expect(container.textContent).toContain('Lead with conclusions and compact tables');
    expect(container.textContent).toContain('Ship Deep-Understanding Onboarding');

    // Confirm and save.
    const saveButton = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Save understanding'))!;
    await act(async () => {
      saveButton.click();
      await Promise.resolve();
    });

    expect(mocks.confirmDeepUnderstandingRun).toHaveBeenCalledWith(
      completedRun.id,
      expect.objectContaining({
        aboutYou: [expect.objectContaining({ id: 'about-1', decision: 'accepted' })],
        writingPreferences: [expect.objectContaining({ id: 'w-1', decision: 'accepted' })],
        markOnboardingCompleted: true,
      }),
    );
    expect(onRequestClose).toHaveBeenCalledOnce();
  });
});
