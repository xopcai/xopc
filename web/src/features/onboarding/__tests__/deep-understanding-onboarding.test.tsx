// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchLocalSourcePreviews: vi.fn(),
  discoverWorkDiscoveryCandidates: vi.fn(),
  startDeepUnderstandingRun: vi.fn(),
  fetchDeepUnderstandingRun: vi.fn(),
  confirmDeepUnderstandingRun: vi.fn(),
  dismissWorkDiscoveryOnboarding: vi.fn(),
  resolveWorkspaceProject: vi.fn(),
  fetchProject: vi.fn(),
  startProjectUnderstanding: vi.fn(),
  fetchProjectUnderstanding: vi.fn(),
  fetchConnectorInstances: vi.fn(),
  fetchComposioConnectorCatalog: vi.fn(),
  importRequest: vi.fn(),
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

vi.mock('@/features/projects/api', () => ({
  resolveWorkspaceProject: mocks.resolveWorkspaceProject,
  fetchProject: mocks.fetchProject,
}));

vi.mock('@/features/imports/import-api', () => ({
  importRequest: mocks.importRequest,
}));

vi.mock('@/features/imports/import-selection-dialog', () => ({
  ImportSelectionDialog: ({
    open,
    sourceName,
    selected,
    onSubmit,
  }: {
    open: boolean;
    sourceName: string;
    selected: Set<string>;
    onSubmit: () => void;
  }) => (open ? (
    <div data-testid="import-selection-dialog">
      <span>{`Import from ${sourceName} (${selected.size})`}</span>
      <button type="button" onClick={onSubmit}>Confirm tool import</button>
    </div>
  ) : null),
}));

vi.mock('@/features/projects/project-understanding-api', () => ({
  startProjectUnderstanding: mocks.startProjectUnderstanding,
  fetchProjectUnderstanding: mocks.fetchProjectUnderstanding,
  isProjectUnderstandingRunning: (status?: string) =>
    status === 'queued' || status === 'probing' || status === 'analyzing',
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="route">{`${location.pathname}${location.search}`}</output>;
}

describe('DeepUnderstandingOnboarding (Parallel User Understanding + Multi-Project Async Setup)', () => {
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
        {
          id: 'cand-docs',
          rootPath: '/Users/demo/develop/docs',
          displayName: 'docs',
          source: 'common_work_root',
          projectKind: 'general',
          projectKindConfidence: 0.85,
          score: 82,
          changedFileCount: 0,
          evidence: ['docs folder'],
        },
      ],
      recentFiles: [],
      processingTarget: { provider: 'openai', remoteModel: true },
    });
    mocks.fetchConnectorInstances.mockResolvedValue([]);
    mocks.fetchComposioConnectorCatalog.mockResolvedValue({ connectors: [] });
    mocks.importRequest.mockImplementation(async (path: string) => {
      if (path === '/sources') {
        return {
          sources: [
            { id: 'codex', name: 'Codex', detected: true },
            { id: 'claude-code', name: 'Claude Code', detected: true },
          ],
        };
      }
      return {};
    });
    mocks.fetchProject.mockImplementation(async (id: string) => ({
      id,
      name: id.replace(/^proj-/, ''),
      slug: id.replace(/^proj-/, ''),
      status: 'active',
      workspaceRoot: `/Users/demo/develop/${id.replace(/^proj-/, '')}`,
      executionMode: 'local_checkout',
      successCriteria: [],
      scope: {},
      nonGoals: [],
      health: 'unknown',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    mocks.dismissWorkDiscoveryOnboarding.mockResolvedValue(undefined);
    mocks.confirmDeepUnderstandingRun.mockResolvedValue({
      ok: true,
      confirmedAssertionIds: ['a1'],
      createdRuleIds: ['r1'],
    });
    mocks.resolveWorkspaceProject.mockImplementation(async ({ workspacePath }: { workspacePath: string }) => {
      const name = workspacePath.split('/').filter(Boolean).pop() ?? 'project';
      return {
        ok: true,
        created: true,
        reason: 'auto_created',
        project: {
          id: `proj-${name}`,
          name,
          slug: name,
          status: 'active',
          workspaceRoot: workspacePath,
          executionMode: 'local_checkout',
          successCriteria: [],
          scope: {},
          nonGoals: [],
          health: 'unknown',
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    });
    mocks.startProjectUnderstanding.mockResolvedValue({ status: 'queued' });
    mocks.fetchProjectUnderstanding.mockResolvedValue({
      status: 'analyzing',
      overview: null,
      updatedAt: null,
    });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    delete window.electronAPI;
    useUnderstandingActivityStore.getState().finish();
    vi.clearAllMocks();
  });

  it('runs user understanding in the background without blocking multi-project creation or direct chat entry', async () => {
    // Keep startDeepUnderstandingRun pending to prove Page 1 NEVER blocks Page 2.
    let resolveDeepStart!: (value: unknown) => void;
    mocks.startDeepUnderstandingRun.mockReturnValue(new Promise((resolve) => { resolveDeepStart = resolve; }));

    const onNavigateAway = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DeepUnderstandingOnboarding onNavigateAway={onNavigateAway} />
          <LocationProbe />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    // Only detected local sources + cloud connectors appear (no noisy undetected Bookmarks card).
    expect(container.textContent).toContain('Obsidian');
    expect(container.textContent).toContain('AI Rules');
    expect(container.textContent).toContain('Gmail');
    expect(container.textContent).not.toContain('Bookmarks');

    // Start Page 1 user understanding (stays in-flight in the background).
    const startButton = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Start learning'))!;
    await act(async () => {
      startButton.click();
      await Promise.resolve();
    });

    // Immediately switch to Page 2 while Page 1 start is STILL pending!
    const continueBgBtn = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Next: Projects'))!;
    await act(async () => {
      continueBgBtn.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Choose one or more folders.');
    expect(container.textContent).toContain('Learning about you in background');

    // Multi-select the second folder (`docs`) in addition to the pre-selected first folder (`xopc`).
    const docsBtn = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('docs'))!;
    await act(async () => {
      docsBtn.click();
      await Promise.resolve();
    });

    // Create 2 projects must NOT be disabled while Page 1 is still launching!
    const createTwoBtn = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Create 2 projects'))!;
    expect(createTwoBtn.disabled).toBe(false);

    await act(async () => {
      createTwoBtn.click();
      await Promise.resolve();
    });

    expect(mocks.resolveWorkspaceProject).toHaveBeenCalledTimes(2);
    expect(mocks.resolveWorkspaceProject).toHaveBeenCalledWith({ workspacePath: '/Users/demo/develop/xopc', autoCreate: true });
    expect(mocks.resolveWorkspaceProject).toHaveBeenCalledWith({ workspacePath: '/Users/demo/develop/docs', autoCreate: true });
    expect(mocks.startProjectUnderstanding).toHaveBeenCalledWith('proj-xopc');
    expect(mocks.startProjectUnderstanding).toHaveBeenCalledWith('proj-docs');

    // Both projects are created and immediately allow jumping into chat without waiting for understanding!
    expect(container.textContent).toContain('2 projects created');
    expect(container.textContent).toContain('Analyzing…');

    // Enter chat directly for the second project (`docs`) while understanding is still running.
    const chatButtons = [...container.querySelectorAll('button')]
      .filter((btn) => btn.textContent?.trim() === 'Chat');
    expect(chatButtons).toHaveLength(2);
    await act(async () => {
      chatButtons[1]?.click();
      await Promise.resolve();
    });

    expect(mocks.dismissWorkDiscoveryOnboarding).toHaveBeenCalledOnce();
    expect(onNavigateAway).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="route"]')?.textContent).toBe('/chat/new?projectId=proj-docs');

    // Even after onboarding left, resolving the pending deep run updates the global background store.
    await act(async () => {
      resolveDeepStart({
        id: 'run-deep-bg',
        status: 'running',
        phase: 'analyzing_writing',
        selectedSources: ['local-obsidian'],
        sourceStatuses: [{ sourceId: 'local-obsidian', status: 'collecting', itemCount: 0 }],
        startedAt: Date.now(),
      });
      await Promise.resolve();
    });
    expect(useUnderstandingActivityStore.getState().deepRun?.id).toBe('run-deep-bg');
  });

  it('also lets users wait for both Step 1 Reveal and Step 2 project understanding completion', async () => {
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
    mocks.fetchProjectUnderstanding.mockResolvedValue({
      status: 'completed',
      overview: 'TypeScript personal assistant monorepo with Gateway and React console.',
      updatedAt: Date.now(),
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <DeepUnderstandingOnboarding onNavigateAway={vi.fn()} />
          <LocationProbe />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const startButton = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Start learning'))!;
    await act(async () => {
      startButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('understanding-completed', {
        detail: { runId: completedRun.id, run: completedRun },
      }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Builds local-first AI desktop tools');

    const saveNextButton = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Save & choose projects'))!;
    await act(async () => {
      saveNextButton.click();
      await Promise.resolve();
    });
    expect(mocks.confirmDeepUnderstandingRun).toHaveBeenCalledWith(
      completedRun.id,
      expect.objectContaining({ markOnboardingCompleted: false }),
    );

    const createBtn = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Create project'))!;
    await act(async () => {
      createBtn.click();
      await Promise.resolve();
    });

    // Simulate background project understanding completing while user waits.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('project-updated', { detail: { id: 'proj-xopc' } }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Projects ready');
    expect(container.textContent).toContain('TypeScript personal assistant monorepo');
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
    expect(container.textContent).toContain('Add notes or Obsidian vault');
    expect(container.textContent).toContain('OneDrive · Custom drive');
    expect(container.textContent).not.toContain('Apple');
  });

  it('imports projects from Codex / Claude Code on Page 2, starts async understanding, and allows direct chat entry', async () => {
    mocks.importRequest.mockImplementation(async (path: string) => {
      if (path === '/sources') {
        return {
          sources: [
            { id: 'codex', name: 'Codex', detected: true },
            { id: 'claude-code', name: 'Claude Code', detected: true },
          ],
        };
      }
      if (path === '/sources/claude-code/scan') {
        return {
          id: 'inv-1',
          source: 'claude-code',
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
          complete: true,
          notices: [],
          candidates: [
            {
              id: 'cand-proj-1',
              kind: 'project',
              name: 'apollo',
              description: '',
              displayPath: '/Users/demo/develop/apollo',
              scope: 'project',
              status: 'ready',
              suggested: false,
            },
            {
              id: 'cand-skill-1',
              kind: 'skill',
              parentId: 'cand-proj-1',
              name: 'deploy',
              description: '',
              displayPath: '/Users/demo/develop/apollo/.claude/skills/deploy',
              scope: 'project',
              status: 'ready',
              suggested: true,
            },
          ],
        };
      }
      if (path === '/runs') {
        return {
          id: 'run-import-1',
          source: 'claude-code',
          createdAt: Date.now(),
          status: 'completed',
          skills: 1,
          context: 0,
          projects: 1,
          skipped: 0,
          issues: [],
          inventoryId: 'inv-1',
          selectionHash: 'hash',
          items: [
            { candidateId: 'cand-proj-1', kind: 'project', name: 'apollo', status: 'imported', targetId: 'proj-apollo' },
          ],
        };
      }
      return {};
    });

    const onNavigateAway = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DeepUnderstandingOnboarding onNavigateAway={onNavigateAway} />
          <LocationProbe />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    // Switch straight to Page 2 (Projects).
    const workspaceTab = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Projects'))!;
    await act(async () => {
      workspaceTab.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Import from');
    expect(container.textContent).toContain('Codex');
    expect(container.textContent).toContain('Claude Code');

    // Click Claude Code to scan & open ImportSelectionDialog.
    const claudeBtn = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Claude Code'))!;
    await act(async () => {
      claudeBtn.click();
      await Promise.resolve();
    });

    expect(mocks.importRequest).toHaveBeenCalledWith('/sources/claude-code/scan', {}, expect.any(AbortSignal));
    expect(container.textContent).toContain('Import from Claude Code (2)');

    // Confirm import -> imports project + starts background understanding -> allows immediate chat entry!
    const confirmImportBtn = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Confirm tool import'))!;
    await act(async () => {
      confirmImportBtn.click();
      await Promise.resolve();
    });

    expect(mocks.fetchProject).toHaveBeenCalledWith('proj-apollo');
    expect(mocks.startProjectUnderstanding).toHaveBeenCalledWith('proj-apollo');
    expect(container.textContent).toContain('apollo');
    expect(container.textContent).toContain('Analyzing…');

    const openNowBtn = [...container.querySelectorAll('button')]
      .find((btn) => btn.textContent?.includes('Open apollo'))!;
    await act(async () => {
      openNowBtn.click();
      await Promise.resolve();
    });

    expect(onNavigateAway).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="route"]')?.textContent).toBe('/chat/new?projectId=proj-apollo');
  });
});
