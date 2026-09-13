// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listSessions } from '../session-api';
import { DEFAULT_SESSION_FILTERS, readSessionFilters } from '../session-discovery-state';
import { useSessionDiscovery } from '../use-session-discovery';
import { SessionFilterToolbar } from '../session-filter-toolbar';
import { readSavedSessionViews, writeSavedSessionViews } from '../session-saved-views';
import { messages } from '@/i18n/messages';
import type { PaginatedResult, SessionMetadata } from '../session.types';

vi.mock('../session-api', () => ({ listSessions: vi.fn() }));
vi.mock('../session-filter-projects', () => ({ allProjectOptions: async () => [
  { id: 'project-a', name: 'Alpha' }, { id: 'project-b', name: 'Beta' },
] }));

describe('session discovery interactions', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let state: ReturnType<typeof useSessionDiscovery>;
  const page = (key: string): PaginatedResult<SessionMetadata> => ({ items: [{ key, sourceChannel: key } as SessionMetadata], total: 1, limit: 30, offset: 0, hasMore: false });
  function Harness() {
    state = useSessionDiscovery('http://test-gateway', 'test-token');
    return <><SessionFilterToolbar filters={state.filters} onChange={state.updateFilters} search={state.search} onSearch={state.setSearch} labels={messages('en').sidebar.sessionFilters} gateway="http://test-gateway" agents={[]} /><output>{state.items.map((row) => row.key).join(',')}</output></>;
  }
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    vi.mocked(listSessions).mockReset().mockResolvedValue(page('result'));
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  async function mount() {
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}><Harness /></SWRConfig>));
  }
  async function click(label: string) {
    const find = () => [...document.querySelectorAll('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label);
    let button = find();
    if (!button && container.querySelector('button[aria-label^="Filters"]')?.getAttribute('aria-expanded') !== 'true') {
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="Filters"]')!.click());
      button = find();
    }
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }

  it('switches quick views, clears conditions without clearing search, and remembers only filters', async () => {
    await mount();
    expect(state!.active).toBe(false);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.textContent).not.toContain('Manual');
    await click('Automatic');
    expect(state!.active).toBe(true);
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('Filters (1)');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(listSessions).toHaveBeenLastCalledWith(expect.objectContaining({ activity: 'automatic', offset: 0 }));
    expect(readSessionFilters('http://test-gateway').activity).toBe('automatic');
    expect(readSessionFilters('http://another-gateway').activity).toBe('');
    await act(async () => state!.setSearch('older conversation'));
    await click('Clear filters');
    expect(state!.search).toBe('older conversation');
    expect(state!.filters.activity).toBe('');
    expect(JSON.stringify(readSessionFilters('http://test-gateway'))).not.toContain('older conversation');
    await act(async () => state!.setSearch(''));
    expect(state!.active).toBe(false);
  });

  it('keeps an old response from replacing a newer source selection', async () => {
    const pending = new Map<string, (value: PaginatedResult<SessionMetadata>) => void>();
    vi.mocked(listSessions).mockImplementation((query) => new Promise((resolve) => pending.set(query!.sources![0], resolve)));
    await mount();
    await act(async () => state!.updateFilters({ ...DEFAULT_SESSION_FILTERS, sources: ['browser'] }));
    await act(async () => state!.updateFilters({ ...DEFAULT_SESSION_FILTERS, sources: ['terminal'] }));
    await act(async () => pending.get('terminal')!(page('terminal')));
    expect(container.querySelector('output')?.textContent).toBe('terminal');
    await act(async () => pending.get('browser')!(page('browser')));
    expect(container.querySelector('output')?.textContent).toBe('terminal');
  });

  it('marks live updates for refresh instead of reordering results automatically', async () => {
    await mount(); await click('Automatic');
    const requests = vi.mocked(listSessions).mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event('session-created')); });
    expect(state!.pendingUpdate).toBe(true);
    expect(vi.mocked(listSessions).mock.calls).toHaveLength(requests);
    await act(async () => state!.refresh());
    expect(state!.pendingUpdate).toBe(false);
    expect(vi.mocked(listSessions).mock.calls.length).toBeGreaterThan(requests);
  });

  it('restores explicitly saved keywords and filters only for their Gateway', () => {
    const view = { id: 'weekly', name: 'Weekly browser research', search: 'weekly report', filters: { ...DEFAULT_SESSION_FILTERS, sources: ['browser'] as const, days: '7' } };
    expect(writeSavedSessionViews('http://test-gateway', [{ ...view, filters: { ...view.filters, sources: [...view.filters.sources] } }])).toBe(true);
    expect(readSavedSessionViews('http://test-gateway')).toMatchObject([{ name: view.name, search: view.search, filters: { sources: ['browser'], days: '7' } }]);
    expect(readSavedSessionViews('http://another-gateway')).toEqual([]);
    expect(writeSavedSessionViews('http://test-gateway', [])).toBe(true);
    expect(readSavedSessionViews('http://test-gateway')).toEqual([]);
  });

  it('drills into one choice list without stacking popovers and keeps multi-select state on return', async () => {
    await mount();
    await click('Created from');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('input[type="checkbox"][value="browser"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Project"]')).toBeNull();
    await act(async () => document.querySelector<HTMLInputElement>('input[value="browser"]')!.click());
    await act(async () => document.querySelector<HTMLInputElement>('input[value="terminal"]')!.click());
    expect(state!.filters.sources).toEqual(['browser', 'terminal']);
    await click('Done');
    expect(document.querySelector('input[type="checkbox"][value="browser"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Created from"]')?.textContent).toContain('Browser extension · Terminal');
    expect(document.querySelector('input[aria-label="View name"]')).toBeNull();
    await click('Created from');
    await click('Clear selection');
    expect(state!.filters.sources).toEqual([]);
    await click('Back');
    expect(document.activeElement?.textContent).toBe('All');
  });

  it('selects a project inside the existing panel and returns to the summary', async () => {
    await mount();
    await click('Project');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Search options');
    await act(async () => document.querySelector<HTMLInputElement>('input[value="project-b"]')!.click());
    expect(state!.filters.project).toBe('project-b');
    expect(document.querySelector('button[aria-label="Project"]')?.textContent).toContain('Beta');
    expect(document.querySelector('input[aria-label="Search options"]')).toBeNull();
  });
});
