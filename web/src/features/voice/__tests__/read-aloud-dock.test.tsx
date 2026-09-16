// @vitest-environment jsdom
import { act } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ReadAloudDock, ReadAloudDockProvider, useReadAloudDock } from '../read-aloud-dock';

function Player() {
  const target = useReadAloudDock();
  const player = <button>Pause audio</button>;
  return target ? createPortal(player, target) : <footer>{player}</footer>;
}

describe('read aloud layout ownership', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  function render(chat: boolean, dialog = false) {
    act(() => root.render(<ReadAloudDockProvider>
      {chat ? <section aria-label="Chat"><ReadAloudDock /><input aria-label="Message" /></section> : null}
      {dialog ? <section aria-label="Dialog"><ReadAloudDock /></section> : null}
      <Player />
    </ReadAloudDockProvider>));
  }
  it('places the player above the composer and restores the page footer on navigation', () => {
    render(false);
    expect(container.querySelector('footer button')).not.toBeNull();
    render(true);
    expect(container.querySelector('section > div > button')).not.toBeNull();
    expect(container.querySelector('footer')).toBeNull();
    render(false);
    expect(container.querySelector('footer button')).not.toBeNull();
  });
  it('restores the underlying chat dock when a dialog chat closes', () => {
    render(true);
    render(true, true);
    expect(container.querySelector('[aria-label="Dialog"] button')).not.toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(1);
    render(true, false);
    expect(container.querySelector('[aria-label="Chat"] button')).not.toBeNull();
  });
});
