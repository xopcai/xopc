// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playerState = vi.hoisted(() => ({
  source: { type: 'chat-message', id: 'message-1', title: 'Read this message', href: '#/chat/chat-1', targetId: 'chat-message-1' },
  status: 'playing',
  currentTime: 9,
  duration: 12,
  durationComplete: true,
  currentText: 'Read this message aloud.',
  error: null,
  rate: 1,
  consentRequired: false,
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  seek: vi.fn(),
  setRate: vi.fn(),
  acceptConsent: vi.fn(),
  declineConsent: vi.fn(),
}));

vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (selector: (state: { language: string }) => unknown) => selector({ language: 'en' }) }));
vi.mock('../read-aloud-dock', () => ({ useReadAloudDock: () => null }));
vi.mock('../read-aloud-store', () => ({ useReadAloudStore: () => playerState }));
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/ui/popover-select', () => ({ PopoverSelect: () => <button type="button">Playback speed</button> }));

import { GlobalReadAloudPlayer } from '../global-read-aloud-player';

describe('GlobalReadAloudPlayer', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows only one progress indicator when expanded', () => {
    act(() => root.render(<GlobalReadAloudPlayer />));
    expect(container.querySelector('div[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('input[type="range"]')).toBeNull();

    const expandButton = container.querySelector('button[aria-expanded="false"]');
    act(() => expandButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.querySelector('div[aria-hidden="true"]')).toBeNull();
    expect(container.querySelector('input[type="range"]')).not.toBeNull();
  });

  it('scrolls back to the source message', () => {
    const source = document.createElement('div');
    source.id = 'chat-message-1';
    source.scrollIntoView = vi.fn();
    document.body.append(source);

    act(() => root.render(<GlobalReadAloudPlayer />));
    const expandButton = container.querySelector('button[aria-expanded="false"]');
    act(() => expandButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const returnLink = container.querySelector<HTMLAnchorElement>('a[href="#/chat/chat-1"]');
    act(() => returnLink?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));

    expect(source.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    source.remove();
  });
});
