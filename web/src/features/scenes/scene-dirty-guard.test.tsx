// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SceneDirtyGuard } from './scene-dirty-guard';

let container: HTMLDivElement;
let unmount: () => void;

afterEach(() => {
  act(unmount);
  container.remove();
  vi.restoreAllMocks();
});

describe('SceneDirtyGuard', () => {
  it('uses the project confirmation dialog before discarding unsaved changes', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm');
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    unmount = () => root.unmount();
    const router = createMemoryRouter([
      {
        path: '/edit',
        element: <><Link to="/next">Leave editor</Link><SceneDirtyGuard dirty zh={false} /></>,
      },
      { path: '/next', element: <p>Next page</p> },
    ], { initialEntries: ['/edit'] });

    await act(async () => root.render(<RouterProvider router={router} />));
    await act(async () => container.querySelector<HTMLAnchorElement>('a')?.click());

    expect(nativeConfirm).not.toHaveBeenCalled();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain('Discard unsaved changes?');
    expect(dialog?.className).toContain('z-[101]');

    const keepEditing = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Keep editing');
    await act(async () => keepEditing?.click());
    expect(container.textContent).toContain('Leave editor');

    await act(async () => container.querySelector<HTMLAnchorElement>('a')?.click());
    const discard = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Discard and leave');
    await act(async () => discard?.click());
    expect(container.textContent).toContain('Next page');
  });
});
