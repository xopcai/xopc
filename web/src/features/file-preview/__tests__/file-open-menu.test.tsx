// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileOpenMenu } from '@/features/file-preview/file-open-menu';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

const iconDataUrl = 'data:image/png;base64,aWNvbg==';
const recommendedApps = [{ name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app', iconDataUrl }];
const otherApp = { name: 'TextEdit', path: '/System/Applications/TextEdit.app', iconDataUrl };

describe('file open menu', () => {
  let container: HTMLDivElement;
  let root: Root;
  const systemOpen = vi.fn();
  const openWith = vi.fn();
  const chooseApp = vi.fn();

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    vi.resetAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(disabled = false, variant: 'split' | 'menu' = 'split') {
    act(() => root.render(<FileOpenMenu variant={variant} systemApp={{ onClick: systemOpen, disabled }}
      chooseApp={{ onClick: chooseApp }} recommendedApps={recommendedApps}
      recentApps={[...recommendedApps, otherApp]} onOpenWithApp={openWith} />));
  }

  async function openMenu() {
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    return document.querySelector<HTMLElement>('[role="menu"]')!;
  }

  it('exposes every open action as menu items without another toolbar button', async () => {
    render(false, 'menu');
    const m = messages('en').workspace;
    expect(container.querySelector('[aria-haspopup]')).toBeNull();
    const items = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      m.openSystemApp, 'Visual Studio Code', 'TextEdit', m.chooseApp,
    ]);
    await act(async () => items[0].click());
    await act(async () => items[1].click());
    await act(async () => items[2].click());
    await act(async () => items[3].click());
    expect(systemOpen).toHaveBeenCalledOnce();
    expect(openWith.mock.calls).toEqual([[recommendedApps[0].path], [otherApp.path]]);
    expect(chooseApp).toHaveBeenCalledOnce();
    render(true, 'menu');
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].every((button) => button.disabled)).toBe(true);
  });

  it('uses the matching application icon and opens with the displayed app', async () => {
    render();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(iconDataUrl);
    const open = container.querySelector<HTMLButtonElement>('button[aria-label="Open with Visual Studio Code"]')!;
    await act(async () => open.click());
    expect(openWith).toHaveBeenCalledWith(recommendedApps[0].path);
    expect(systemOpen).not.toHaveBeenCalled();
  });

  it('selects recent apps, deduplicates recommendations, and remembers the chosen open action', async () => {
    render();
    const menu = await openMenu();
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.filter((item) => item.textContent === 'Visual Studio Code')).toHaveLength(1);
    await act(async () => items.find((item) => item.textContent === 'TextEdit')!.click());
    expect(openWith).toHaveBeenLastCalledWith(otherApp.path);
    const open = container.querySelector<HTMLButtonElement>('button[aria-label="Open with TextEdit"]')!;
    await act(async () => open.click());
    expect(openWith).toHaveBeenCalledTimes(2);
    expect(openWith).toHaveBeenLastCalledWith(otherApp.path);
  });

  it('offers system default and the native application picker', async () => {
    render();
    const m = messages('en').workspace;
    let menu = await openMenu();
    await act(async () => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === m.chooseApp)!.click());
    expect(chooseApp).toHaveBeenCalledOnce();
    menu = await openMenu();
    await act(async () => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === m.openSystemApp)!.click());
    expect(systemOpen).toHaveBeenCalledOnce();
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${m.openSystemApp}"]`)!.click());
    expect(systemOpen).toHaveBeenCalledTimes(2);
  });

  it('updates the main button after picking another application in the system dialog', async () => {
    chooseApp.mockResolvedValueOnce(otherApp);
    render();
    const menu = await openMenu();
    await act(async () => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === messages('en').workspace.chooseApp)!.click());
    const open = container.querySelector<HTMLButtonElement>('button[aria-label="Open with TextEdit"]')!;
    expect(open).not.toBeNull();
    await act(async () => open.click());
    expect(openWith).toHaveBeenLastCalledWith(otherApp.path);
  });

  it('closes on Escape without bubbling the preview close shortcut', async () => {
    render();
    const menu = await openMenu();
    const previewClose = vi.fn();
    window.addEventListener('keydown', previewClose);
    try {
      await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(previewClose).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', previewClose); }
  });

  it('keeps the open action available if the application icon cannot load', async () => {
    render();
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Open with Visual Studio Code"]')!.disabled).toBe(false);
  });

  it('disables both actions when the file cannot be opened', () => {
    render(true);
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].every((button) => button.disabled)).toBe(true);
  });
});
