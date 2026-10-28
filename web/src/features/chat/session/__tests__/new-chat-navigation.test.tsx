// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, Outlet, RouterProvider, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { navigateToNewChat, NewChatLink } from '../new-chat-navigation';

describe('new chat navigation focus', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let router: ReturnType<typeof createMemoryRouter>;
  let duringClick: Element | null;

  function Shell() {
    const [drawerOpen, setDrawerOpen] = useState(true);
    const navigate = useNavigate();
    return <>
      <NewChatLink to="/chat/new" state={{ forceNewChat: true }} onClick={() => setDrawerOpen(false)}>New chat</NewChatLink>
      <button onClick={() => navigateToNewChat(navigate, '/chat/new', undefined, () => setDrawerOpen(false))}>New project chat</button>
      <NewChatLink to="/chat/new" onClick={event => event.preventDefault()}>Cancelled</NewChatLink>
      {drawerOpen ? <aside>Drawer</aside> : null}
      <Outlet />
    </>;
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    duringClick = null;
    router = createMemoryRouter([{
      element: <Shell />,
      children: [
        { path: '/', element: <p>Home</p> },
        { path: '/chat/new', element: <>
          <div><div role="textbox" contentEditable data-secondary="true" /></div>
          <div data-primary-chat-composer><div role="textbox" contentEditable /></div>
        </> },
      ],
    }]);
    act(() => root.render(<RouterProvider router={router} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    router.dispose();
    container.remove();
    vi.unstubAllGlobals();
  });

  const click = (element: HTMLElement, init?: MouseEventInit) => {
    // This listener runs before the original click dispatch returns, just like a user gesture.
    const observe = (event: MouseEvent) => {
      duringClick = document.activeElement;
      // jsdom cannot open a separate browser tab for modified clicks.
      if (event.ctrlKey) event.preventDefault();
    };
    document.addEventListener('click', observe, { once: true });
    act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })));
  };

  it('closes the drawer and focuses the new primary editor within the mobile click', () => {
    click(container.querySelector('a')!);
    expect(router.state.location.pathname).toBe('/chat/new');
    expect(router.state.location.state).toEqual({ forceNewChat: true });
    expect(container.querySelector('aside')).toBeNull();
    expect(duringClick).toBe(container.querySelector('[data-primary-chat-composer] [role="textbox"]'));
  });

  it('also focuses for button-driven project creation', () => {
    click(container.querySelector('button')!);
    expect(container.querySelector('aside')).toBeNull();
    expect(duringClick).toBe(container.querySelector('[data-primary-chat-composer] [role="textbox"]'));
  });

  it('preserves cancelled link navigation', () => {
    click(container.querySelectorAll('a')[1]);
    expect(router.state.location.pathname).toBe('/');
    expect(container.querySelector('[role="textbox"]')).toBeNull();
  });

  it('does not take over modified clicks', () => {
    click(container.querySelector('a')!, { ctrlKey: true });
    expect(router.state.location.pathname).toBe('/');
  });

  it('does not focus on direct route entry or background updates', async () => {
    await act(async () => { await router.navigate('/chat/new'); });
    expect(document.activeElement?.getAttribute('role')).not.toBe('textbox');
    const editor = container.querySelector<HTMLElement>('[data-primary-chat-composer] [role="textbox"]')!;
    act(() => { editor.focus(); editor.blur(); });
    await act(async () => { await router.navigate('/chat/new', { replace: true }); });
    expect(document.activeElement).not.toBe(editor);
  });
});
