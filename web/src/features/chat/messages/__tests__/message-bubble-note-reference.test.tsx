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

describe('MessageBubble Note reference attachment', () => {
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
      'button[aria-label="Referenced Notes: Launch plan"]',
    );
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Launch plan');

    act(() => card?.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(
      '/notes/note-1?returnTo=%2Fchat%2Fsession-1%3Fview%3Dfull',
    );
  });
});
