// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import { useLocaleStore } from '@/stores/locale-store';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe('MessageBubble context reference attachment', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders as an attachment card and opens the referenced Note with a chat return path', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat/session-1?view=full']}>
          <Routes>
            <Route
              path="*"
              element={(
                <>
                  <MessageBubble
                    message={{
                      role: 'user',
                      content: [{ type: 'text', text: 'Review this' }],
                      contextRefs: [{
                        kind: 'note', sourceId: 'note-1', version: '42', title: 'Launch plan',
                      }],
                    }}
                    isStreaming={false}
                    progress={null}
                  />
                  <LocationProbe />
                </>
              )}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    const card = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Referenced context: Launch plan"]',
    );
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Launch plan');

    act(() => card?.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(
      '/notes/note-1?returnTo=%2Fchat%2Fsession-1%3Fview%3Dfull',
    );
  });

  it('renders a selected directory with a folder icon and label', () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <MessageBubble
            message={{
              role: 'user',
              content: [{ type: 'text', text: 'Review this folder' }],
              contextRefs: [{
                kind: 'file', sourceId: 'folder-1', version: '7', title: 'mobile-expo',
                fileKind: 'directory',
              }],
            }}
            isStreaming={false}
            progress={null}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('.lucide-folder')).not.toBeNull();
    expect(container.textContent).toContain('Folders');
    expect(container.textContent).toContain('mobile-expo');
    const renderedText = container.textContent ?? '';
    expect(renderedText.indexOf('Review this folder')).toBeLessThan(renderedText.indexOf('Folders'));
  });

  it('renders an explicit directory reference inline at its authored position', () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <MessageBubble
            message={{
              role: 'user',
              content: [{ type: 'text', text: 'Analyze @evals please' }],
              userTurnDocument: {
                version: 1,
                parts: [
                  { type: 'text', text: 'Analyze ' },
                  { type: 'context_ref', refId: 'ref-1' },
                  { type: 'text', text: ' please' },
                ],
              },
              contextRefs: [{
                refId: 'ref-1', kind: 'file', sourceId: 'folder-1', version: '7', title: 'evals',
                fileKind: 'directory',
              }],
            }}
            isStreaming={false}
            progress={null}
          />
        </MemoryRouter>,
      );
    });

    const inline = container.querySelector<HTMLElement>('[data-context-ref-id="ref-1"]');
    expect(inline?.textContent).toBe('evals');
    expect(inline?.dataset.fileKind).toBe('directory');
    expect(inline?.querySelector('.lucide-folder')).not.toBeNull();
    const rendered = container.textContent ?? '';
    expect(rendered.indexOf('Analyze')).toBeLessThan(rendered.indexOf('evals'));
    expect(rendered.indexOf('evals')).toBeLessThan(rendered.indexOf('please'));
    expect(container.textContent).not.toContain('Folders');
  });

  it('renders inline reference kinds with canonical icons and keeps punctuation attached', () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <MessageBubble
            message={{
              role: 'user',
              content: [{ type: 'text', text: 'Compare Plan readme.md Prior chat Docs tab Schema.' }],
              userTurnDocument: {
                version: 1,
                parts: [
                  { type: 'text', text: 'Compare ' },
                  { type: 'context_ref', refId: 'note-ref' },
                  { type: 'text', text: ' ' },
                  { type: 'context_ref', refId: 'file-ref' },
                  { type: 'text', text: ' ' },
                  { type: 'context_ref', refId: 'session-ref' },
                  { type: 'text', text: ' ' },
                  { type: 'context_ref', refId: 'tab-ref' },
                  { type: 'text', text: ' ' },
                  { type: 'context_ref', refId: 'mcp-ref' },
                  { type: 'text', text: '.' },
                ],
              },
              contextRefs: [
                { refId: 'note-ref', kind: 'note', sourceId: 'note-1', version: '1', title: 'Plan' },
                { refId: 'file-ref', kind: 'file', fileKind: 'file', sourceId: 'file-1', version: '1', title: 'readme.md' },
                { refId: 'session-ref', kind: 'session', sourceId: 'chat-1', version: '1', title: 'Prior chat' },
                { refId: 'tab-ref', kind: 'browser_tab', sourceId: 'tab-1', version: '1', title: 'Docs tab' },
                { refId: 'mcp-ref', kind: 'mcp_resource', sourceId: 'resource-1', version: '1', title: 'Schema' },
              ],
            }}
            isStreaming={false}
            progress={null}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('.lucide-notebook-pen')).not.toBeNull();
    expect(container.querySelector('.lucide-file-text')).not.toBeNull();
    expect(container.querySelector('.lucide-messages-square')).not.toBeNull();
    expect(container.querySelector('.lucide-app-window')).not.toBeNull();
    expect(container.querySelector('.lucide-database')).not.toBeNull();
    expect(container.querySelector('[data-context-ref-id="file-ref"]')?.classList.contains('ms-1')).toBe(false);
    expect(container.querySelector('[data-context-ref-id="mcp-ref"]')?.classList.contains('me-1')).toBe(false);
    expect(container.textContent).not.toContain('Referenced context');
  });

  it('renders every supported non-Note reference type in a user message', () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <MessageBubble
            message={{
              role: 'user',
              content: [],
              contextRefs: [
                { kind: 'file', fileKind: 'file', sourceId: 'file-1', version: '1', title: 'readme.md' },
                { kind: 'session', sourceId: 'chat-1', version: '1', title: 'Prior chat' },
                { kind: 'browser_tab', sourceId: 'tab-1', version: '1', title: 'Docs tab' },
                { kind: 'mcp_resource', sourceId: 'resource-1', version: '1', title: 'Schema' },
              ],
            }}
            isStreaming={false}
            progress={null}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('.lucide-file-text')).not.toBeNull();
    expect(container.querySelector('.lucide-messages-square')).not.toBeNull();
    expect(container.querySelector('.lucide-app-window')).not.toBeNull();
    expect(container.querySelector('.lucide-database')).toBeNull();
    expect(container.textContent).not.toContain('Schema');

    const expand = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    expect(expand?.textContent).toContain('1 more');
    act(() => expand?.click());

    expect(container.querySelector('.lucide-database')).not.toBeNull();
    expect(container.textContent).toContain('readme.md');
    expect(container.textContent).toContain('Prior chat');
    expect(container.textContent).toContain('Docs tab');
    expect(container.textContent).toContain('Schema');
    expect(container.querySelector('button[aria-expanded="true"]')?.textContent).toContain('Show fewer');
  });
});
