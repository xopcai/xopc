// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { expect, it, vi } from 'vitest';

import { fetchJson } from '@/lib/fetch';
import { TasksPage } from '../tasks-page';

vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));
vi.mock('@/features/projects/api', () => ({ fetchProjects: async () => ({ items: [] }) }));
vi.mock('@/stores/locale-store', () => ({
  useLocaleStore: (select: (state: { language: string }) => unknown) => select({ language: 'en' }),
}));

it('loads the first and subsequent task pages through the strict read contract', async () => {
  const requests: unknown[] = [];
  const items = Array.from({ length: 101 }, (_, index) => ({
    task: {
      id: `task-${index}`, title: `Task #${index}`, phase: 'ready', priority: 'normal',
      source: 'api', version: 1, latestContractVersion: 1, createdAt: 1, updatedAt: 1,
    },
    operationalState: 'idle',
    attention: [],
    presentation: { status: 'ready' },
  }));
  vi.mocked(fetchJson).mockImplementation(async (_url, init) => {
    if (!init) return { majorVersion: 1, descriptorDigest: 'test' };
    const { input } = JSON.parse(String(init.body));
    requests.push(input);
    return { status: 'succeeded', data: { ok: true, items: items.slice(input.offset, input.offset + input.limit), total: items.length } };
  });

  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
        <MemoryRouter><TasksPage /></MemoryRouter>
      </SWRConfig>,
    ));
    await vi.waitFor(() => expect(container.textContent).toContain('Task #99'));
    expect(requests).toContainEqual({ limit: 100, offset: 0 });
    expect(container.textContent).not.toContain('Task #100');

    const more = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Load more'))!;
    await act(async () => more.click());
    await vi.waitFor(() => expect(container.textContent).toContain('Task #100'));
    expect(requests).toContainEqual({ limit: 100, offset: 100 });
    expect(container.textContent).not.toContain('Load more');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
