// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';

const { fetchUserModel } = vi.hoisted(() => ({ fetchUserModel: vi.fn() }));

vi.mock('@/features/user-model/user-model-api', () => ({
  fetchUserModel,
  correctAssertion: vi.fn(),
  setAssertionStatus: vi.fn(),
}));

import type { WorkDiscoveryRun } from '../api';
import { useUnderstandingActivityStore } from '../understanding-activity-store';
import { UnderstandingStatusButton } from '../understanding-status-button';

const completedRun: WorkDiscoveryRun = {
  id: 'run-ready',
  status: 'completed',
  rootPath: '/work/xopc',
  projectId: 'project-1',
  sessionKey: 'session-1',
  result: {
    projectSummary: 'The onboarding flow is the current focus.',
    currentState: 'The user is improving understanding onboarding.',
    uncertainties: [],
    suggestions: [],
  },
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

describe('UnderstandingStatusButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    fetchUserModel.mockResolvedValue({
      profile: {},
      assertions: [{
        id: 'assertion-1',
        predicate: 'identity.work_discovery.role:builder',
        statement: 'Builds developer tools.',
        kind: 'identity',
        status: 'candidate',
        authority: 'system_inferred',
        confidence: 0.9,
        inferredImportance: 0.6,
        consequence: 'low',
        actionability: 0.5,
        volatility: 'stable',
        sensitivity: 'normal',
        observedAt: 1,
        recordedAt: 1,
        createdAt: 1,
        createdBy: 'runtime',
        scope: { type: 'global' },
        sources: [{ id: 'work-folder:project-1', kind: 'work_folder', label: 'xopc', category: 'files', observedAt: 1 }],
      }, {
        id: 'assertion-project-1',
        predicate: 'project.work_discovery.stack',
        statement: 'This repository uses a monorepo architecture.',
        kind: 'derived_insight',
        status: 'candidate',
        authority: 'system_inferred',
        confidence: 0.9,
        inferredImportance: 0.6,
        consequence: 'low',
        actionability: 0.5,
        volatility: 'stable',
        sensitivity: 'normal',
        observedAt: 1,
        recordedAt: 1,
        createdAt: 1,
        createdBy: 'runtime',
        scope: { type: 'project', id: 'project-1' },
        sources: [{ id: 'work-folder:project-1', kind: 'work_folder', label: 'xopc', category: 'files', observedAt: 1 }],
      }],
      goals: [], priorities: [], rules: [], knowledge: [],
      sources: [{
        id: 'source-1', kind: 'work_folder', adapterId: 'local-work-folders',
        category: 'files', displayName: 'xopc', lastCollectedAt: 1,
      }],
      maintenance: { lastRun: null },
      counts: {
        activeAssertions: 0, reviewAssertions: 1, activeGoals: 0,
        activePriorities: 0, activeKnowledge: 0,
      },
    });
    useUnderstandingActivityStore.setState({
      status: 'review_ready',
      drawerOpen: false,
      directoryStatus: 'completed',
      directoryRun: completedRun,
      sources: {},
      itemCounts: {},
      memories: [],
      threads: [],
      error: undefined,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useUnderstandingActivityStore.getState().finish();
  });

  it('does not render the understanding entry on chat', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat']}>
          <UnderstandingStatusButton />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[aria-label="Review what xopc understands"]')).toBeNull();
  });

  it('stays hidden outside the user-model page when there is no activity', () => {
    useUnderstandingActivityStore.getState().finish();
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat']}>
          <UnderstandingStatusButton />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[data-work-discovery-trigger]')).toBeNull();
  });

  it('shows global source-to-understanding context instead of the project summary', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/user-model']}>
          <UnderstandingStatusButton />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Review what xopc understands"]');
    await act(async () => trigger?.click());

    expect(document.body.textContent).toContain('How xopc forms its understanding of you');
    expect(document.body.textContent).toContain('Work folder · xopc');
    expect(document.body.textContent).toContain('Builds developer tools.');
    expect(document.body.textContent).not.toContain('The onboarding flow is the current focus.');
    expect(document.body.textContent).not.toContain('This repository uses a monorepo architecture.');
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/user-model');
  });

  it('opens a completed run linked from a product notification', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/user-model?workDiscovery=review&run=run-ready']}>
          <UnderstandingStatusButton />
        </MemoryRouter>,
      );
    });

    expect(document.body.textContent).toContain('How xopc forms its understanding of you');
  });
});
