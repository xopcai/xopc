// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';
import { NotesHomeComposer } from '../notes-home-composer';
import { prepareAgentNote } from '../note-creation';

vi.mock('../note-creation', () => ({ prepareAgentNote: vi.fn(), noteCreationChatHref: () => '/chat/test' }));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function render() {
  act(() => root.render(<MemoryRouter><NotesHomeComposer projects={[{ id: 'p1', name: 'Project', noteCount: 1 }]}
    projectId="p1" onProjectChange={vi.fn()} onCreated={vi.fn()} labels={messages('en').notes} projectsLoading={false} projectsError={false} /></MemoryRouter>));
}

describe('notes home composer', () => {
  it('retains selected files after resetting the native file input and hands them to the agent', async () => {
    vi.mocked(prepareAgentNote).mockResolvedValue({ noteId: 'n1', sessionKey: 'chat' });
    render();
    const file = new File(['source'], 'reference.txt', { type: 'text/plain' });
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { configurable: true, get: () => input.dataset.cleared ? [] : [file] });
    Object.defineProperty(input, 'value', { configurable: true, set: () => { input.dataset.cleared = 'true'; } });
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.textContent).toContain('reference.txt');
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(prepareAgentNote).toHaveBeenCalledWith(expect.objectContaining({ files: [file], projectId: 'p1' }));
  });

  it('keeps the pending request and exposes retry after a failed submission', async () => {
    vi.mocked(prepareAgentNote).mockRejectedValue(new Error('Upload failed'));
    render();
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.txt')] });
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container.querySelector('[role=alert]')?.textContent).toContain('Upload failed');
    expect(container.querySelector('fieldset')!.disabled).toBe(true);
    const firstRequest = vi.mocked(prepareAgentNote).mock.calls[0][0];
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(vi.mocked(prepareAgentNote).mock.calls[1][0]).toBe(firstRequest);
  });
});
