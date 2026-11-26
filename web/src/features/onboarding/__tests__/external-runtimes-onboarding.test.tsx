// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  fetchLocalSourcePreviews: vi.fn(),
  discoverWorkDiscoveryCandidates: vi.fn(),
  resolveWorkspaceProject: vi.fn(),
  fetchProject: vi.fn(),
  startProjectUnderstanding: vi.fn(),
  fetchProjectUnderstanding: vi.fn(),
  fetchConnectorInstances: vi.fn(),
  fetchComposioConnectorCatalog: vi.fn(),
  importRequest: vi.fn(),
  fetchGatewayAgents: vi.fn(),
  fetchExternalAgentRuntimesFast: vi.fn(),
  fetchExternalAgentRuntimes: vi.fn(),
  quickSetupExternalAgentRuntimes: vi.fn(),
  startExternalRuntimeAuth: vi.fn(),
}));

vi.mock('@/features/work-discovery/api', () => ({
  fetchLocalSourcePreviews: mocks.fetchLocalSourcePreviews,
  discoverWorkDiscoveryCandidates: mocks.discoverWorkDiscoveryCandidates,
  startDeepUnderstandingRun: vi.fn(),
  fetchDeepUnderstandingRun: vi.fn(),
  cancelDeepUnderstandingRun: vi.fn(async () => ({})),
  confirmDeepUnderstandingRun: vi.fn(),
  dismissWorkDiscoveryOnboarding: vi.fn(async () => ({})),
}));

vi.mock('@/features/projects/api', () => ({
  resolveWorkspaceProject: mocks.resolveWorkspaceProject,
  fetchProject: mocks.fetchProject,
}));

vi.mock('@/features/imports/import-api', () => ({
  importRequest: mocks.importRequest,
}));

vi.mock('@/features/imports/import-selection-dialog', () => ({
  ImportSelectionDialog: () => null,
}));

vi.mock('@/features/projects/project-understanding-api', () => ({
  startProjectUnderstanding: mocks.startProjectUnderstanding,
  fetchProjectUnderstanding: mocks.fetchProjectUnderstanding,
  isProjectUnderstandingRunning: () => false,
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

vi.mock('@/features/settings/agents-admin-api', () => ({
  fetchGatewayAgents: mocks.fetchGatewayAgents,
  fetchExternalAgentRuntimesFast: mocks.fetchExternalAgentRuntimesFast,
  fetchExternalAgentRuntimes: mocks.fetchExternalAgentRuntimes,
  quickSetupExternalAgentRuntimes: mocks.quickSetupExternalAgentRuntimes,
  startExternalRuntimeAuth: mocks.startExternalRuntimeAuth,
  fetchExternalRuntimeAuthFlow: vi.fn(),
  respondExternalRuntimeAuthFlow: vi.fn(),
  cancelExternalRuntimeAuthFlow: vi.fn(),
  logoutExternalAgentRuntime: vi.fn(),
  probeExternalAgentRuntime: vi.fn(),
}));

vi.mock('@/stores/locale-store', () => ({
  useLocaleStore: (selector: (state: { language: 'en'; setLanguage: () => void }) => unknown) =>
    selector({ language: 'en', setLanguage: vi.fn() }),
}));

import { DeepUnderstandingOnboarding } from '../deep-understanding-onboarding';
import { resetDesktopOnboardingPreload } from '../desktop-onboarding-bootstrap';

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

describe('External runtimes in DeepUnderstandingOnboarding', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    resetDesktopOnboardingPreload();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    mocks.fetchLocalSourcePreviews.mockResolvedValue({ platform: 'darwin', previews: [] });
    mocks.discoverWorkDiscoveryCandidates.mockResolvedValue({
      processingTarget: { provider: 'openai', remoteModel: true },
      candidates: [
        {
          rootPath: '/Users/demo/develop/xopc',
          displayName: 'xopc',
          projectKind: 'coding',
          branch: 'main',
          changedFileCount: 0,
        },
      ],
      recentFiles: [],
    });
    mocks.fetchConnectorInstances.mockResolvedValue([]);
    mocks.fetchComposioConnectorCatalog.mockResolvedValue({ connectors: [] });
    mocks.fetchGatewayAgents.mockResolvedValue({ defaultId: 'main', agents: [], builtinToolIds: [] });
    mocks.importRequest.mockImplementation(async (path: string) => {
      if (path === '/sources') {
        return {
          sources: [
            { id: 'codex', name: 'Codex', detected: true },
            { id: 'claude-code', name: 'Claude Code', detected: true },
          ],
        };
      }
      if (path.endsWith('/scan')) {
        return {
          id: 'inv-1',
          source: 'claude-code',
          createdAt: 0,
          expiresAt: Date.now() + 60_000,
          complete: true,
          notices: [],
          candidates: [
            {
              id: 'skill-1',
              kind: 'skill',
              name: 'my-skill',
              description: '',
              displayPath: '/Users/demo/.claude/skills/my-skill',
              scope: 'user',
              status: 'ready',
              suggested: true,
            },
          ],
        };
      }
      if (path === '/runs') {
        return {
          id: 'run-1',
          source: 'claude-code',
          createdAt: 0,
          inventoryId: 'inv-1',
          selectionHash: 'h',
          status: 'completed',
          items: [],
          skills: 1,
          context: 0,
          projects: 0,
          skipped: 0,
          issues: [],
        };
      }
      return {};
    });
    mocks.startProjectUnderstanding.mockResolvedValue({ status: 'completed' });
    mocks.fetchProjectUnderstanding.mockResolvedValue({ status: 'completed', overview: 'Demo overview' });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('hides the external runtimes section completely when no host CLIs are installed', async () => {
    mocks.fetchExternalAgentRuntimesFast.mockResolvedValue([
      { kind: 'codex', label: 'Codex', installed: false, checkedAt: 1 },
      { kind: 'agy', label: 'Antigravity', installed: false, checkedAt: 1 },
      { kind: 'claude', label: 'Claude Code', installed: false, checkedAt: 1 },
    ]);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <DeepUnderstandingOnboarding embedded />
        </MemoryRouter>,
      );
    });
    await flush();

    // Go to Page 2 (Projects)
    const skipBtn = [...container.querySelectorAll('button')].find((btn) => btn.textContent?.includes('Skip'));
    await act(async () => { skipBtn?.click(); });
    await flush();

    expect(container.querySelector('[data-onboarding-external-runtimes]')).toBeNull();
  });

  it('auto-selects ready runtimes, provisions them with full_access + read_write, binds project defaultAgentId, and syncs skills', async () => {
    mocks.fetchExternalAgentRuntimesFast.mockResolvedValue([
      { kind: 'codex', label: 'Codex', installed: true, executablePath: '/opt/homebrew/bin/codex', checkedAt: 1 },
      { kind: 'agy', label: 'Antigravity', installed: false, checkedAt: 1 },
      { kind: 'claude', label: 'Claude Code', installed: true, executablePath: '/Users/demo/.local/bin/claude', checkedAt: 1 },
    ]);
    mocks.fetchExternalAgentRuntimes.mockResolvedValue([
      {
        kind: 'codex',
        label: 'Codex',
        installed: true,
        status: 'unauthenticated',
        executablePath: '/opt/homebrew/bin/codex',
        version: '0.32.0',
        models: [],
        checkedAt: 2,
      },
      {
        kind: 'agy',
        label: 'Antigravity',
        installed: false,
        status: 'not_installed',
        models: [],
        checkedAt: 2,
      },
      {
        kind: 'claude',
        label: 'Claude Code',
        installed: true,
        status: 'ready',
        executablePath: '/Users/demo/.local/bin/claude',
        version: '1.2.3',
        account: { label: 'dev@example.com' },
        models: [{ id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', isDefault: true }],
        checkedAt: 2,
      },
    ]);
    mocks.quickSetupExternalAgentRuntimes.mockResolvedValue({
      results: [{ kind: 'claude', agentId: 'claude-code', created: true, status: 'ok' }],
      agents: {
        defaultId: 'main',
        builtinToolIds: [],
        agents: [
          {
            id: 'claude-code',
            name: 'Claude Code',
            workspace: '/tmp',
            profileDir: '/tmp',
            isDefault: false,
            override: { id: 'claude-code', enabled: true, execution: { kind: 'claude', permissionMode: 'full_access', contextAccess: 'read_write' } },
            effective: {} as never,
            sources: {},
          },
        ],
      },
    });
    mocks.resolveWorkspaceProject.mockResolvedValue({
      ok: true,
      created: true,
      project: {
        id: 'proj-1',
        name: 'xopc',
        slug: 'xopc',
        status: 'active',
        defaultAgentId: 'claude-code',
        workspaceRoot: '/Users/demo/develop/xopc',
        executionMode: 'local_checkout',
        successCriteria: [],
        scope: {},
        nonGoals: [],
        health: 'unknown',
        version: 1,
        createdAt: '',
        updatedAt: '',
      },
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <DeepUnderstandingOnboarding embedded />
        </MemoryRouter>,
      );
    });
    await flush();

    // Navigate to Page 2
    const skipBtn = [...container.querySelectorAll('button')].find((btn) => btn.textContent?.includes('Skip'));
    await act(async () => { skipBtn?.click(); });
    await flush();

    expect(container.querySelector('[data-onboarding-external-runtimes]')).not.toBeNull();
    expect(container.querySelector('[data-external-runtime-row="claude"]')).not.toBeNull();
    expect(container.querySelector('[data-external-runtime-row="codex"]')).not.toBeNull();
    expect(container.querySelector('[data-external-runtime-row="agy"]')).toBeNull();

    // Summary shows open defaults (Full access + Context read & write)
    expect(container.textContent).toContain('Full access');
    expect(container.textContent).toContain('Context read & write');

    // Submit combined setup
    const submitBtn = [...container.querySelectorAll('button')].find((btn) => btn.textContent?.includes('Create & connect'));
    expect(submitBtn).toBeTruthy();
    await act(async () => { submitBtn?.click(); });
    await flush();

    expect(mocks.quickSetupExternalAgentRuntimes).toHaveBeenCalledWith([
      { kind: 'claude', permissionMode: 'full_access', contextAccess: 'read_write' },
    ]);
    expect(mocks.resolveWorkspaceProject).toHaveBeenCalledWith({
      workspacePath: '/Users/demo/develop/xopc',
      autoCreate: true,
      defaultAgentId: 'claude-code',
    });
    expect(container.querySelector('[data-onboarding-connected-runtimes]')).not.toBeNull();
    expect(container.textContent).toContain('Synced 1 skills & rules');
  });

  it('allows connecting external runtimes even when no project folder is selected', async () => {
    mocks.discoverWorkDiscoveryCandidates.mockResolvedValue({
      processingTarget: { provider: 'openai', remoteModel: true },
      candidates: [],
      recentFiles: [],
    });
    mocks.fetchExternalAgentRuntimesFast.mockResolvedValue([
      { kind: 'codex', label: 'Codex', installed: true, executablePath: '/usr/local/bin/codex', checkedAt: 1 },
    ]);
    mocks.fetchExternalAgentRuntimes.mockResolvedValue([
      {
        kind: 'codex',
        label: 'Codex',
        installed: true,
        status: 'ready',
        executablePath: '/usr/local/bin/codex',
        models: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex', isDefault: true }],
        checkedAt: 2,
      },
    ]);
    mocks.quickSetupExternalAgentRuntimes.mockResolvedValue({
      results: [{ kind: 'codex', agentId: 'codex', created: true, status: 'ok' }],
      agents: { defaultId: 'main', builtinToolIds: [], agents: [] },
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <DeepUnderstandingOnboarding embedded />
        </MemoryRouter>,
      );
    });
    await flush();

    const skipBtn = [...container.querySelectorAll('button')].find((btn) => btn.textContent?.includes('Skip'));
    await act(async () => { skipBtn?.click(); });
    await flush();

    const connectBtn = [...container.querySelectorAll('button')].find((btn) => btn.textContent?.includes('Connect 1 agent'));
    expect(connectBtn).toBeTruthy();
    await act(async () => { connectBtn?.click(); });
    await flush();

    expect(mocks.quickSetupExternalAgentRuntimes).toHaveBeenCalledWith([
      { kind: 'codex', permissionMode: 'full_access', contextAccess: 'read_write' },
    ]);
    expect(mocks.resolveWorkspaceProject).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Coding agents ready');
  });
});
