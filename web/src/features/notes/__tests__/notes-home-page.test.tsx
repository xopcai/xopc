// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { NotesHomePage } from '../notes-home-page';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock('../notes-api', () => ({
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  listNoteProjects: vi.fn().mockResolvedValue({ items: [] }),
  listNotes: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  listNoteTags: vi.fn().mockResolvedValue({ items: [] }),
  updateNote: vi.fn(),
}));

vi.mock('@/features/discussions/discussion-draft-store', () => ({
  listDiscussionDrafts: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/features/discussions/meeting-import-button', () => ({
  MeetingImportButton: () => null,
}));

vi.mock('../note-detail-panel', () => ({
  NoteDetailPanel: () => <div data-testid="note-detail-panel" />,
}));

vi.mock('../notes-home-composer', () => ({
  NotesHomeComposer: () => null,
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  window.localStorage.clear();
  useGatewayStore.setState({ conversationId: 'test-token' });
  useLocaleStore.setState({ language: 'zh' });
  usePageHeaderStore.getState().clearPageHeader();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  usePageHeaderStore.getState().clearPageHeader();
});

async function renderNotesHome(selectedNoteId?: string) {
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter initialEntries={[selectedNoteId ? `/notes/${selectedNoteId}` : '/notes']}>
          <Routes>
            <Route path="/notes" element={<NotesHomePage selectedNoteId={selectedNoteId} />} />
            <Route path="/notes/:noteId" element={<NotesHomePage selectedNoteId={selectedNoteId} />} />
          </Routes>
        </MemoryRouter>
      </SWRConfig>,
    );
    await Promise.resolve();
  });
}

describe('NotesHomePage navigation rail toggle layout', () => {
  it('omits the rail toggle from the page header and toggles the rail from the notes pane', async () => {
    await renderNotesHome();

    expect(usePageHeaderStore.getState().startExtra).toBeNull();

    const collapseButton = container.querySelector<HTMLButtonElement>('button[aria-label="收起分类侧栏"]');
    expect(collapseButton).not.toBeNull();
    expect(container.querySelector('button[aria-label="展开分类侧栏"]')).toBeNull();

    act(() => {
      collapseButton?.click();
    });

    expect(usePageHeaderStore.getState().startExtra).toBeNull();
    expect(container.querySelector('aside')).toBeNull();
    expect(container.querySelector('button[aria-label="收起分类侧栏"]')).toBeNull();

    const expandButton = container.querySelector<HTMLButtonElement>('button[aria-label="展开分类侧栏"]');
    expect(expandButton).not.toBeNull();

    act(() => {
      expandButton?.click();
    });

    expect(usePageHeaderStore.getState().startExtra).toBeNull();
    expect(container.querySelector('aside')).not.toBeNull();
    expect(container.querySelector('button[aria-label="收起分类侧栏"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="展开分类侧栏"]')).toBeNull();
  });
});
