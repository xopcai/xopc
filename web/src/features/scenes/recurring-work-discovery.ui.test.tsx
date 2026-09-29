// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getNote, listNotes, type Note, type NoteIndexEntry } from '@/features/notes/notes-api';

import { RecurringWorkDiscovery, RecurringWorkPlanDetail } from './recurring-work-discovery';

vi.mock('@/features/notes/notes-api', () => ({ listNotes: vi.fn(), getNote: vi.fn() }));
vi.mock('@/stores/gateway-store', () => ({
  useGatewayStore: (selector: (state: { conversationId: string }) => unknown) => selector({ conversationId: 'test-session' }),
}));
vi.mock('@/stores/locale-store', () => ({
  useLocaleStore: (selector: (state: { language: 'en' }) => unknown) => selector({ language: 'en' }),
}));
vi.mock('@/features/notes/note-markdown-view', () => ({ NoteMarkdownView: () => null }));

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function plan(id: string, tags: string[]): NoteIndexEntry {
  return { id, title: id, kind: 'thought', status: 'inbox', tags, createdAt: 1, updatedAt: 1 };
}

async function renderDiscovery() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}><RecurringWorkDiscovery /></SWRConfig></MemoryRouter>);
  });
}

async function renderDetail() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}><RecurringWorkPlanDetail noteId="plan-1" /></SWRConfig></MemoryRouter>);
  });
}

function detail(tags: string[]): Note {
  return {
    id: 'plan-1', title: 'My plan', markdown: 'The current brief.', kind: 'thought', status: 'inbox', tags,
    createdAt: 1, updatedAt: 1, capturedVia: { channel: 'web' },
  };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.resetAllMocks();
});

describe('recurring work discovery', () => {
  it('shows the next step and only offers preparation for ready plans', async () => {
    vi.mocked(listNotes).mockResolvedValue({
      items: [plan('draft', ['recurring-work-spec', 'recurring-work-draft']), plan('ready', ['recurring-work-spec', 'recurring-work-ready'])],
      total: 2,
    });
    await renderDiscovery();
    expect(host?.textContent).toContain('Needs more detail');
    expect(host?.textContent).toContain('Ready to prepare');
    const readyCard = host?.querySelector('[data-plan-stage="ready"]');
    expect(readyCard?.textContent).toContain('Prepare');
    const draftCard = host?.querySelector('[data-plan-stage="draft"]');
    expect(draftCard?.textContent).not.toContain('Prepare');
  });

  it('finds plans beyond the first page, including processed notes', async () => {
    vi.mocked(listNotes).mockImplementation(async (query) => ({
      items: query?.offset === 10 ? [{ ...plan('eleventh', ['recurring-work-spec', 'recurring-work-ready']), status: 'processed' }]
        : Array.from({ length: 10 }, (_, index) => plan(`plan-${index}`, ['recurring-work-spec', 'recurring-work-draft'])),
      total: 11,
    }));
    await renderDiscovery();
    await act(async () => {
      Array.from(host!.querySelectorAll('button')).find((button) => button.textContent === 'Next')?.click();
    });
    expect(vi.mocked(listNotes).mock.calls.at(-1)?.[0]).toMatchObject({ offset: 10, limit: 10 });
    expect(vi.mocked(listNotes).mock.calls.at(-1)?.[0]?.status).toBeUndefined();
    expect(host?.textContent).toContain('eleventh');
  });

  it('shows a retry action when the saved-plan list fails', async () => {
    vi.mocked(listNotes).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], total: 0 });
    await renderDiscovery();
    expect(host?.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    await act(async () => {
      Array.from(host!.querySelectorAll('button')).find((button) => button.textContent === 'Retry')?.click();
    });
    expect(host?.textContent).toContain('No saved plans yet');
  });

  it('keeps conflicting plan states out of the implementation path', async () => {
    vi.mocked(getNote).mockResolvedValue(detail(['recurring-work-spec', 'recurring-work-draft', 'recurring-work-ready']));
    await renderDetail();
    expect(host?.textContent).toContain('Needs review');
    expect(host?.textContent).toContain('Continue discussion');
    expect(host?.textContent).not.toContain('Prepare implementation');
  });
});
