// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

const { mutate, model } = vi.hoisted(() => ({
  mutate: vi.fn(),
  model: {
    profile: { callName: 'Mic', role: 'Builder', timezone: 'Asia/Shanghai', locale: 'en-US' },
    assertions: [
      {
        id: 'explicit-1', predicate: 'identity.role', statement: 'Builds developer tools.', kind: 'identity',
        status: 'active', authority: 'user_explicit', usable: true, confidence: 1, inferredImportance: 0.8,
        consequence: 'medium', actionability: 0.8, volatility: 'stable', sensitivity: 'normal',
        observedAt: 1, recordedAt: 1, createdAt: 1, createdBy: 'user', scope: { type: 'global' },
      },
      {
        id: 'learned-1', predicate: 'preference.detail', statement: 'Prefers visual summaries.', kind: 'preference',
        status: 'active', authority: 'system_inferred', usable: true, confidence: 0.8, inferredImportance: 0.6,
        consequence: 'low', actionability: 0.7, volatility: 'slow', sensitivity: 'normal',
        observedAt: 2, recordedAt: 2, createdAt: 2, createdBy: 'runtime', scope: { type: 'global' },
      },
      {
        id: 'pending-1', predicate: 'current_state.focus', statement: 'May be preparing a launch.', kind: 'current_state',
        status: 'needs_review', authority: 'system_inferred', usable: false, confidence: 0.6, inferredImportance: 0.5,
        consequence: 'low', actionability: 0.5, volatility: 'dynamic', sensitivity: 'normal',
        observedAt: 3, recordedAt: 3, createdAt: 3, createdBy: 'runtime', scope: { type: 'global' },
      },
    ],
    goals: [], priorities: [], rules: [],
    knowledge: [
      { id: 'project-1', content: 'Project uses React.', recordClass: 'memory', kind: 'project_fact', status: 'active', scope: { type: 'global' }, confidence: 1, importance: 0.8 },
      { id: 'workspace-1', content: 'Workspace uses pnpm.', recordClass: 'memory', kind: 'workspace_fact', status: 'active', scope: { type: 'global' }, confidence: 1, importance: 0.7 },
    ],
    maintenance: { lastRun: null },
    counts: { activeAssertions: 2, reviewAssertions: 1, activeGoals: 0, activePriorities: 0, activeKnowledge: 2 },
  },
}));

vi.mock('swr', () => ({
  default: () => ({ data: model, error: undefined, isLoading: false, isValidating: false, mutate }),
}));
vi.mock('@/features/work-discovery/understanding-status-button', () => ({
  UnderstandingStatusButton: () => null,
}));

import { UserModelPage } from '../user-model-page';

function HeaderEnd() {
  const end = usePageHeaderStore((state) => state.end);
  return <div data-testid="header-end">{end}</div>;
}

function RouterState() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <output data-testid="router-location">{`${location.pathname}${location.search}`}</output>
      <button type="button" data-testid="router-back" onClick={() => navigate(-1)}>Back</button>
    </div>
  );
}

describe('UserModelPage summary navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useLocaleStore.setState({ language: 'en' });
    usePageHeaderStore.getState().clearPageHeader();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/user-model']}>
        <UserModelPage />
        <HeaderEnd />
        <RouterState />
      </MemoryRouter>,
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePageHeaderStore.getState().clearPageHeader();
    vi.clearAllMocks();
  });

  it('opens a filtered understanding view from each summary count', async () => {
    const learned = container.querySelector<HTMLButtonElement>('[aria-label="Learned together: 1"]');
    expect(learned).not.toBeNull();

    await act(async () => learned?.click());

    const selected = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-pressed="true"]'))
      .find((button) => button.textContent?.includes('Learned together'));
    expect(selected).toBeDefined();
    expect(container.textContent).toContain('Prefers visual summaries.');
    expect(container.textContent).not.toContain('Builds developer tools.');
    expect(container.textContent).not.toContain('May be preparing a launch.');
  });

  it('opens a filtered work-memory view from a category count', async () => {
    const projectFacts = container.querySelector<HTMLButtonElement>('[aria-label="Project facts: 1"]');
    expect(projectFacts).not.toBeNull();

    await act(async () => projectFacts?.click());

    const selected = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-pressed="true"]'))
      .find((button) => button.textContent?.includes('Project facts'));
    expect(selected).toBeDefined();
    expect(container.textContent).toContain('Project uses React.');
    expect(container.textContent).not.toContain('Workspace uses pnpm.');
  });

  it('uses all available width when only two memory categories have content', () => {
    const grid = container.querySelector('[data-testid="memory-summary-grid"]');
    expect(grid?.className).toContain('sm:grid-cols-2');
    expect(grid?.className).not.toContain('lg:grid-cols-4');
  });

  it('uses whitespace and surface contrast instead of bordered overview containers', () => {
    const hero = container.querySelector('[data-testid="overview-hero"]');
    const priority = container.querySelector('[data-testid="priority-panel"]');

    expect(hero?.className).not.toContain('border');
    expect(priority?.className).not.toContain('border');
    expect(priority?.className).toContain('bg-surface-panel');
  });

  it('places refresh in the shell header instead of the page footer', async () => {
    const headerRefresh = container.querySelector<HTMLButtonElement>('[data-testid="header-end"] button');
    expect(headerRefresh?.textContent).toContain('Refresh');
    expect(container.querySelector('footer button')).toBeNull();

    await act(async () => headerRefresh?.click());
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('pushes tab changes into browser history and restores the previous tab on back', async () => {
    const workMemoryTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent?.includes('Work memory'));
    expect(workMemoryTab).toBeDefined();

    await act(async () => workMemoryTab?.click());
    expect(container.querySelector('[data-testid="router-location"]')?.textContent)
      .toBe('/user-model?tab=knowledge');
    expect(workMemoryTab?.getAttribute('aria-selected')).toBe('true');

    const back = container.querySelector<HTMLButtonElement>('[data-testid="router-back"]');
    await act(async () => back?.click());

    expect(container.querySelector('[data-testid="router-location"]')?.textContent).toBe('/user-model');
    const overviewTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent?.includes('Your portrait'));
    expect(overviewTab?.getAttribute('aria-selected')).toBe('true');
  });
});
