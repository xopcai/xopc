// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(), listener: undefined as undefined | ((value: any) => void), snapshot: {} as any,
  capture: vi.fn(), activeTab: vi.fn(), screenshot: vi.fn(), store: undefined as any,
}));
vi.mock('./chat-client', () => ({ BrowserChatClient: class {
  subscribe(listener: (value: unknown) => void) { mocks.listener = listener; listener(mocks.snapshot); return () => {}; }
  get currentSessionKey() { return mocks.snapshot.sessionKey; }
  async start() {} stop() {} async refreshInputs() {} send = mocks.send;
} }));
vi.mock('./page-context', async importOriginal => ({ ...await importOriginal<object>(), captureTabWithPermission: mocks.capture, activeTabId: mocks.activeTab }));
vi.mock('./voice-input', () => ({ VoiceInput: () => null }));
vi.mock('./markdown-content', () => ({ MarkdownContent: ({ children }: any) => <div>{children}</div> }));
vi.mock('./attachments', async importOriginal => ({ ...await importOriginal<object>(), captureVisibleScreenshot: mocks.screenshot }));
vi.mock('./composer-drafts', async importOriginal => {
  const actual = await importOriginal<typeof import('./composer-drafts')>();
  const { useSyncExternalStore } = await import('react');
  return { ...actual, useComposerDrafts: (key: string) => {
    const store = mocks.store;
    const draft = useSyncExternalStore(store.subscribe, () => store.get(key));
    return { store, draft, ready: true, update: (update: any) => store.update(key, update) };
  } };
});
import { ComposerDrafts } from './composer-drafts';
import { ChatPanel } from './chat-panel';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function emit(patch: object) { mocks.snapshot = { ...mocks.snapshot, ...patch }; mocks.listener?.(mocks.snapshot); }
function text(value: string) {
  const input = container.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function button(label: string) { return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; }

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.send.mockReset().mockResolvedValue('sent');
  mocks.screenshot.mockReset();
  mocks.capture.mockReset(); mocks.activeTab.mockReset();
  mocks.store = new ComposerDrafts(vi.fn(), vi.fn().mockResolvedValue(undefined));
  mocks.snapshot = { connection: 'connected', endpointReady: true, sessionLoading: false, submitting: false, stopping: false, pendingDelivery: false, sessionKey: 'a', sessions: [], messages: [], streamingText: '', models: [] };
  const event = { addListener: vi.fn(), removeListener: vi.fn() };
  vi.stubGlobal('chrome', { i18n: { getMessage: (key: string) => key }, storage: { session: { get: vi.fn().mockResolvedValue({}), remove: vi.fn().mockResolvedValue(undefined) } }, tabs: { onUpdated: event, onRemoved: event, onActivated: event } });
  HTMLElement.prototype.scrollTo = vi.fn();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<ChatPanel gatewayId="gateway-one" />); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('browser composer interactions', () => {
  it('does not send when Enter confirms IME composition', async () => {
    await act(async () => text('你好'));
    const input = container.querySelector('textarea')!;
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    expect(mocks.send).not.toHaveBeenCalled();
    await act(async () => button('sendMessage').click());
    expect(mocks.send).toHaveBeenCalledWith('你好', [], []);
    expect(input.value).toBe('');
  });
  it('applies connection guards even to direct form submission', async () => {
    await act(async () => { text('keep'); emit({ endpointReady: false }); });
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mocks.send).not.toHaveBeenCalled();
    expect(container.querySelector('textarea')!.value).toBe('keep');
  });
  it('keeps drafts and late screenshots with their originating session', async () => {
    let resolve!: (value: unknown) => void;
    mocks.screenshot.mockImplementation(() => new Promise(done => { resolve = done; }));
    await act(async () => text('A draft'));
    await act(async () => button('addContext').click());
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('screenshot'))!.click());
    await act(async () => emit({ sessionKey: 'b' }));
    expect(container.querySelector('textarea')!.value).toBe('');
    await act(async () => { resolve({ type: 'image', mimeType: 'image/png', name: 'a.png', size: 3, data: 'AAAA' }); });
    expect(container.querySelector('.attachment-chip')).toBeNull();
    await act(async () => text('B draft'));
    await act(async () => emit({ sessionKey: 'a' }));
    expect(container.querySelector('textarea')!.value).toBe('A draft');
    expect(container.querySelector('.attachment-chip')?.textContent).toContain('a.png');
  });
  it('exposes an explicit queue button while a run is active', async () => {
    await act(async () => { emit({ runId: 'run-1' }); text('follow up'); });
    expect(button('stopResponse')).toBeTruthy();
    await act(async () => button('queueMessage').click());
    expect(mocks.send).toHaveBeenCalledWith('follow up', [], []);
  });
  it('adds two independent pages and rejects a third without replacing them', async () => {
    for (const id of [1, 2, 3]) {
      mocks.activeTab.mockResolvedValueOnce(id);
      mocks.capture.mockResolvedValueOnce({ kind: 'browser_page', sourceId: crypto.randomUUID(), version: 'a'.repeat(64), title: `Page ${id}`, url: `https://example.com/${id}`, documentId: `doc-${id}`, capturedAt: Date.now(), text: 'page text', truncated: false });
      await act(async () => button('addContext').click());
      await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('currentPage'))!.click());
    }
    expect(container.querySelectorAll('.context-chip')).toHaveLength(2);
    expect(container.querySelector('.composer-contexts')?.textContent).toContain('Page 1');
    expect(container.querySelector('.composer-contexts')?.textContent).toContain('Page 2');
    expect(container.querySelector('.composer-error')?.textContent).toContain('errorPageLimit');
  });

  it('keeps valid files when another file in the batch is unsupported', async () => {
    const valid = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(valid, 'arrayBuffer', { value: async () => new TextEncoder().encode('hello').buffer });
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [valid, new File(['bad'], 'program.exe')] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.querySelectorAll('.attachment-chip')).toHaveLength(1);
    expect(container.querySelector('.attachment-chip')?.textContent).toContain('notes.txt');
    expect(container.querySelector('.composer-error')?.textContent).toContain('program.exe');
  });

  it('walks input history and restores the unfinished draft', async () => {
    await act(async () => { emit({ messages: [{ id: 'old', role: 'user', text: 'previous prompt' }] }); text('unfinished'); });
    const input = container.querySelector('textarea')!;
    input.setSelectionRange(0, 0);
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })));
    expect(input.value).toBe('previous prompt');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    expect(input.value).toBe('unfinished');
  });

  it('attaches a context-menu selection to the restored chat', async () => {
    const pending = { tabId: 1, source: 'current_selection', context: { kind: 'browser_page', sourceId: crypto.randomUUID(), version: 'a'.repeat(64), title: 'Selected page', url: 'https://example.com/', documentId: 'doc', capturedAt: Date.now(), selection: 'selected text', truncated: false } };
    await act(async () => mocks.store.update(JSON.stringify(['gateway-one', 'a']), (draft: any) => ({ ...draft, text: 'existing draft' })));
    chrome.storage.session.get = vi.fn().mockResolvedValueOnce({ 'xopc.browser.pending-context': pending }).mockResolvedValue({});
    await act(async () => root.render(<ChatPanel key="reopened" gatewayId="gateway-one" />));
    expect(container.querySelector('.context-chip')?.textContent).toContain('Selected page');
    expect(container.querySelector('textarea')!.value).toBe('existing draft');
    expect(chrome.storage.session.remove).toHaveBeenCalledWith('xopc.browser.pending-context');
  });

});
