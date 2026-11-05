// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  note: { id: 'note', title: 'Meeting', markdown: 'Existing note', kind: 'voice', status: 'inbox', attachments: [], createdAt: 1, updatedAt: 1, remoteVersion: 1 },
  open: vi.fn(), update: vi.fn(), mutate: vi.fn(), sent: vi.fn(),
}));
vi.mock('swr', () => ({ default: (key: unknown) => ({
  data: Array.isArray(key) && key[0] === 'note-detail' ? { ...mocks.note, id: key[1] } : Array.isArray(key) && key[0] === 'note-discussion-document' ? { discussion: { id: 'meeting' } } : [],
  isLoading: false, mutate: mocks.mutate,
}) }));
vi.mock('../notes-api', async original => ({ ...await original<object>(), getNote: vi.fn(), listNoteThreads: vi.fn(), openNoteChat: mocks.open, updateNote: mocks.update }));
vi.mock('@/features/automations/product-automation-feedback', () => ({ ProductAutomationFeedback: () => null }));
vi.mock('@/features/discussions/discussion-note-sections', () => ({ DiscussionNoteSections: ({ noteActions, personalNotes, onPersonalNotes, personalNotesActive }: { noteActions: { onChat: () => void }; personalNotes: React.ReactNode; onPersonalNotes: () => void; personalNotesActive: boolean }) => <div><button onClick={noteActions.onChat}>AI chat</button><button onClick={onPersonalNotes}>My notes</button>{personalNotesActive ? personalNotes : null}</div> }));
vi.mock('@/components/block-editor', () => ({ BlockEditor: ({ content, onChange }: { content: string; onChange: (value: string) => void }) => <textarea aria-label="Editor" defaultValue={content} onChange={event => onChange(event.target.value)} /> }));
vi.mock('@/features/chat/chat-page', () => ({ ChatPage: ({ conversationId, beforeSend }: { conversationId: string; beforeSend: () => Promise<boolean> }) => <div data-conversation={conversationId}><button onClick={async () => { if (await beforeSend()) mocks.sent(); }}>Send</button></div> }));

import { NoteDetailPanel } from '../note-detail-panel';
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const button = (text: string) => [...container.querySelectorAll('button')].find(item => item.textContent === text)!;
function LocationProbe() { return <output>{useLocation().pathname}</output>; }
const render = async (id = 'note') => { await act(async () => root.render(<MemoryRouter initialEntries={['/notes/note']}><NoteDetailPanel noteId={id} onBack={() => {}} /><LocationProbe /></MemoryRouter>)); };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); mocks.open.mockResolvedValue({ conversationId: 'note-chat' }); mocks.mutate.mockResolvedValue(mocks.note); mocks.update.mockResolvedValue(mocks.note);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('opens a persistent conversation to the right of the document without navigating away and reuses it after closing', async () => {
  await render(); await act(async () => button('AI chat').click());
  const aside = container.querySelector('aside')!;
  expect(aside.querySelector('[data-conversation]')?.getAttribute('data-conversation')).toBe('note-chat');
  expect(container.querySelector('output')?.textContent).toBe('/notes/note');
  expect(aside.previousElementSibling?.textContent).toContain('My notes');
  await act(async () => aside.querySelector('header button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(aside.className).toContain('hidden');
  await act(async () => button('AI chat').click());
  expect(mocks.open).toHaveBeenCalledTimes(1);
});

it('does not attach a late conversation response after switching notes', async () => {
  let resolve!: (value: { conversationId: string }) => void;
  mocks.open.mockReturnValue(new Promise(done => { resolve = done; }));
  await render(); await act(async () => button('AI chat').click());
  await render('another-note');
  await act(async () => resolve({ conversationId: 'old-chat' }));
  expect(container.querySelector('[data-conversation]')).toBeNull();
});

it('flushes unsaved personal text before sending and blocks sends when that save fails', async () => {
  await render(); await act(async () => button('AI chat').click());
  await act(async () => button('My notes').click());
  const editor = container.querySelector<HTMLTextAreaElement>('[aria-label="Editor"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, 'Latest human edit');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  });
  mocks.update.mockRejectedValue(new Error('Save unavailable'));
  await act(async () => button('Send').click());
  expect(mocks.update).toHaveBeenCalledWith('note', { markdown: 'Latest human edit' }, 1);
  expect(mocks.sent).not.toHaveBeenCalled();
  mocks.update.mockResolvedValue(mocks.note);
  await act(async () => button('Send').click());
  expect(mocks.sent).toHaveBeenCalledTimes(1);
});
