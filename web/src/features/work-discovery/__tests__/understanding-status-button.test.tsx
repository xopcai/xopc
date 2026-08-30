// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';

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
    useUnderstandingActivityStore.setState({
      status: 'review_ready',
      drawerOpen: false,
      directoryStatus: 'completed',
      directoryRun: completedRun,
      sources: {},
      itemCounts: {},
      memories: [],
      threads: [],
      focuses: [],
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

  it('stays hidden outside the You page', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat']}>
          <UnderstandingStatusButton />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[aria-label="Review what xopc understands"]')).toBeNull();
  });

  it('reviews a completed directory run in place instead of navigating back to onboarding', async () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/you']}>
          <UnderstandingStatusButton persistent />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Review what xopc understands"]');
    await act(async () => trigger?.click());

    expect(document.body.textContent).toContain('Here is what I understand so far');
    expect(document.body.textContent).not.toContain('Review and confirm');
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/you');
  });
});
