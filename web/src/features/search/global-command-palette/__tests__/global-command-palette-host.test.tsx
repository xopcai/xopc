// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ portal: false, uiExtensions: [] as never[] }));
vi.mock('@/lib/use-media-query', () => ({ useMediaQuery: () => mocks.portal }));
vi.mock('@/features/extensions/extension-provider', () => ({ useUiExtensions: () => mocks.uiExtensions }));
vi.mock('@/features/chat/palette/command-palette-api', () => ({
  fetchCommandsCached: vi.fn().mockResolvedValue([]),
  getSkillsCached: vi.fn().mockResolvedValue({ catalog: [] }),
}));
vi.mock('@/features/search/global-command-palette/search-api', () => ({
  searchGlobal: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/features/sessions/session-api', () => ({
  listSessions: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock('@/features/chat/palette/at-mention-api', () => ({
  searchWorkspaceEntries: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/features/search/global-command-palette/desktop-menu-provider', () => ({
  buildDesktopMenuActionHits: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/features/search/global-command-palette/connector-palette-api', () => ({
  getConnectorPaletteIndex: vi.fn().mockResolvedValue({ catalog: [], instances: [] }),
}));

import { SettingsSheet } from '@/components/shell/settings-sheet';
import { GlobalCommandPaletteHost } from '../global-command-palette-host';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function Location() {
  return <output data-testid="route">{useLocation().pathname}</output>;
}

const route = () => document.querySelector('[data-testid="route"]')?.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  if (!HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  mocks.portal = false;
});

afterEach(async () => {
  try {
    await act(async () => {
      root.unmount();
      await vi.advanceTimersByTimeAsync(0);
    });
  } finally {
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

async function renderSettingsWithPalette(portal: boolean) {
  mocks.portal = portal;
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/settings/overview']}>
        <GlobalCommandPaletteHost />
        <SettingsSheet>
          <button type="button">Settings control</button>
        </SettingsSheet>
        <Location />
      </MemoryRouter>,
    );
  });
}

describe('GlobalCommandPaletteHost over SettingsSheet', () => {
  it.each([false, true])('focuses the search input and allows typing when opened via Cmd+K on settings (portal=%s)', async (portal) => {
    await renderSettingsWithPalette(portal);

    const settingsButton = document.querySelector<HTMLButtonElement>('button')!;
    await act(async () => {
      settingsButton.focus();
    });
    expect(document.activeElement).toBe(settingsButton);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(0);
    });

    const input = document.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);

    const paletteDialog = input!.closest<HTMLElement>('[role="dialog"]')!;
    expect(paletteDialog.style.pointerEvents).toBe('auto');

    // Focusing the search input programmatically must not be stolen back by SettingsSheet's FocusScope.
    await act(async () => {
      input!.focus();
    });
    expect(document.activeElement).toBe(input);

    // Typing updates the controlled search input value.
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      nativeSetter.call(input, 'appearance');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input!.value).toBe('appearance');

    // Pressing Escape closes only the command palette and keeps the settings route open.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.querySelector('input[type="search"]')).toBeNull();
    expect(route()).toBe('/settings/overview');

    // A second Escape dismisses SettingsSheet itself.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(route()).toBe('/chat');
  });
});
