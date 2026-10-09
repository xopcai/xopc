// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoteDetailPage } from '../note-detail-page';

vi.mock('../note-detail-panel', () => ({ NoteDetailPanel: ({ onBack }: { onBack: () => void }) => <button onClick={onBack}>Back</button> }));

function LocationProbe() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('note full page return navigation', () => {
  it.each([
    ['/personal?view=full', '/personal?view=full'],
    ['https://example.com', '/notes'],
  ])('returns safely from a note opened with returnTo=%s', (returnTo, expected) => {
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    act(() => root.render(<MemoryRouter initialEntries={[`/notes/n1?returnTo=${encodeURIComponent(returnTo)}`]}>
      <Routes><Route path="/notes/:noteId" element={<NoteDetailPage />} /><Route path="*" element={null} /></Routes>
      <LocationProbe />
    </MemoryRouter>));
    act(() => container.querySelector('button')?.click());
    expect(container.querySelector('output')?.textContent).toBe(expected);
  });
});
