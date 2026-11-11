// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

const { mutate, model, useSWR } = vi.hoisted(() => ({
  mutate: vi.fn(),
  useSWR: vi.fn(),
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
    settings: { memoryEnabled: true, showMemoryReferences: true, sensitiveWritePolicy: 'confirm' },
    counts: { activeAssertions: 2, reviewAssertions: 1, activeGoals: 0, activePriorities: 0, activeKnowledge: 2 },
  },
}));

vi.mock('swr', () => ({
  default: useSWR,
}));
vi.mock('@/features/work-discovery/understanding-status-button', () => ({
  UnderstandingStatusButton: () => null,
}));

import { UserModelPage } from '../user-model-page';

beforeAll(() => {
  class TestResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = TestResizeObserver;
});

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
    useSWR.mockImplementation((key: string | null) => ({
      data: key?.startsWith('/api/knowledge-memory') ? { items: model.knowledge } : key ? model : undefined,
      isLoading: false, isValidating: false, mutate,
    }));
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

  function click(label: string) {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((candidate) => candidate.textContent?.trim() === label);
    expect(button).toBeDefined();
    return act(async () => button?.click());
  }

  it('shows only collaboration preferences and actionable controls in the overview', () => {
    expect(container.textContent).toContain('Set current focus');
    expect(container.textContent).toContain('Add preference');
    expect(container.textContent).toContain('Prefers visual summaries.');
    expect(container.textContent).toContain('Inferred by xopc');
    expect(container.textContent).not.toContain('Builds developer tools.');
    expect(container.textContent).not.toContain('May be preparing a launch.');
    expect(container.textContent).not.toContain('Project uses React.');
    expect(useSWR.mock.calls.some(([key]) => key?.startsWith('/api/knowledge-memory'))).toBe(false);
  });

  it('provides a Markdown view of the collaboration notes', async () => {
    await click('View Markdown');
    const markdown = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown"]');
    expect(markdown?.value).toContain('- Prefers visual summaries. (learned by xopc)');
    expect(markdown?.value).not.toContain('Project uses React.');
    expect(markdown?.readOnly).toBe(true);
  });

  it('searches personal details and lets the user recover from an empty result', async () => {
    await click('View personal understanding');
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Search memories"]');
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'unmatched');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="router-location"]')?.textContent).toContain('search=unmatched');
    expect(container.textContent).toContain('No matching details.');
    await click('Clear filters');
    expect(container.textContent).toContain('Prefers visual summaries.');
    expect(container.querySelector('[data-testid="router-location"]')?.textContent).not.toContain('search=');
  });

  it('loads work memory on demand from data and privacy', async () => {
    await click('Data & privacy');
    expect(useSWR.mock.calls.some(([key]) => key?.startsWith('/api/knowledge-memory'))).toBe(false);
    const manage = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Manage work memory'));
    await act(async () => manage?.click());
    expect(container.querySelector('[data-testid="router-location"]')?.textContent).toBe('/user-model?tab=work');
    expect(useSWR.mock.calls.some(([key]) => key === '/api/knowledge-memory?view=manage')).toBe(true);
    expect(container.textContent).toContain('Project uses React.');
    expect(container.textContent).not.toContain('Prefers visual summaries.');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="router-back"]')?.click());
    expect(container.querySelector('[data-testid="router-location"]')?.textContent).toBe('/user-model?tab=privacy');
  });

  it('keeps the Loopi brand mark for the profile identity', () => {
    const mark = container.querySelector('[data-testid="overview-hero"] [data-loopi="ceramic-v4"]');
    expect(mark?.getAttribute('data-mood')).toBe('listen');
  });

  it('lets the user set a current focus from the empty state', async () => {
    const setFocus = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Set current focus'));
    expect(setFocus).toBeDefined();

    await act(async () => setFocus?.click());

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Set current focus');
    expect(document.querySelector<HTMLInputElement>('input[placeholder="What matters most right now?"]'))
      .not.toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
    const dateTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="Focus through"]');
    expect(dateTrigger).not.toBeNull();

    await act(async () => dateTrigger?.click());

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.className).not.toContain('overflow-hidden');
    expect(dialog?.querySelector('form')?.className).toContain('overflow-hidden');
    expect(dialog?.querySelector('[role="grid"]')).not.toBeNull();
  });

  it('offers a searchable timezone picker in the profile editor', async () => {
    const editProfile = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Edit basics'));
    await act(async () => editProfile?.click());

    const timezone = document.querySelector<HTMLButtonElement>('button[aria-label="Timezone"]');
    expect(timezone?.textContent).toContain('Asia/Shanghai');
    await act(async () => timezone?.click());

    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search timezones…"]');
    expect(search).not.toBeNull();
    const scrollRegion = document.querySelector<HTMLElement>('[data-select-scroll-region]');
    expect(scrollRegion?.className).toContain('overflow-y-auto');
    expect(scrollRegion?.closest('.xopc-dialog-content')).not.toBeNull();
    const newYork = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('America/New York'));
    expect(newYork).toBeDefined();
    await act(async () => newYork?.click());

    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Timezone"]')?.textContent)
      .toContain('America/New_York');
  });

  it('places refresh in the shell header instead of the page footer', async () => {
    const headerRefresh = container.querySelector<HTMLButtonElement>('[data-testid="header-end"] button');
    expect(headerRefresh?.textContent).toBe('');
    expect(headerRefresh?.getAttribute('aria-label')).toBe('Refresh');
    expect(container.querySelector('footer button')).toBeNull();

    await act(async () => headerRefresh?.click());
    expect(mutate).toHaveBeenCalledTimes(1);
    const refreshed = container.querySelector<HTMLButtonElement>('[data-testid="header-end"] button');
    expect(refreshed?.getAttribute('aria-label')).toBe('Refreshed');
    expect(refreshed?.querySelector('.lucide-check')).not.toBeNull();
  });

  it('returns to the overview through browser history', async () => {
    await click('View personal understanding');
    expect(container.querySelector('[data-testid="router-location"]')?.textContent)
      .toBe('/user-model?tab=understanding');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="router-back"]')?.click());
    expect(container.querySelector('[data-testid="router-location"]')?.textContent).toBe('/user-model');
    expect(container.querySelector('[data-testid="overview-hero"]')).not.toBeNull();
  });

  it('keeps the memory settings and import/export in data and privacy', async () => {
    await click('Data & privacy');
    expect(container.textContent).toContain('Your information, under your control');
    expect(container.textContent).toContain('Import from another AI');
    expect(container.textContent).toContain('Download my memory');
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2);
    expect(container.textContent).not.toContain('Coming soon');
  });
});
