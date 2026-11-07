// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';

import { resolveSettingsBackTarget } from '../settings-nav-state';
import { useSettingsNavigationOrigin } from '../use-settings-navigation-origin';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function Harness() {
  useSettingsNavigationOrigin();
  const location = useLocation();
  return <>
    <output>{`${location.pathname}${location.search}${location.hash}`}</output>
    <Link to="/settings/personal" state={{ keep: 'other state' }}>Settings</Link>
    <Link to="/settings/preferences">Preferences</Link>
    <Link to={resolveSettingsBackTarget(location.state)} id="back">Back to app</Link>
    <pre>{JSON.stringify(location.state)}</pre>
  </>;
}
async function render(path: string, state?: Record<string, unknown>) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: path.split(/[?#]/u)[0],
    search: path.includes('?') ? `?${path.split('?')[1].split('#')[0]}` : '',
    hash: path.includes('#') ? `#${path.split('#')[1]}` : '', state }]}><Harness /></MemoryRouter>));
}
afterEach(() => { act(() => root.unmount()); container.remove(); });

it.each(['/personal', '/chat/conversation-1?view=chat', '/projects/project-1/notes#note-1'])(
  'returns to %s after entering settings and switching tabs', async origin => {
    await render(origin);
    await act(async () => [...container.querySelectorAll('a')].find(link => link.textContent === 'Settings')!.click());
    expect(container.querySelector('pre')?.textContent).toContain('other state');
    expect(container.querySelector('#back')?.getAttribute('href')).toBe(origin);
    await act(async () => [...container.querySelectorAll('a')].find(link => link.textContent === 'Preferences')!.click());
    expect(container.querySelector('#back')?.getAttribute('href')).toBe(origin);
    await act(async () => (container.querySelector('#back') as HTMLAnchorElement).click());
    expect(container.querySelector('output')?.textContent).toBe(origin);
  });

it('uses the saved origin after loading a settings history entry again', async () => {
  await render('/settings/preferences', { settingsBackPath: '/personal' });
  expect(container.querySelector('#back')?.getAttribute('href')).toBe('/personal');
});

it.each([['/settings/personal', '/personal'], ['/settings/overview', '/chat']])(
  'chooses a useful fallback when opening %s directly', async (path, target) => {
    await render(path);
    expect(container.querySelector('#back')?.getAttribute('href')).toBe(target);
  });

it('does not turn returning to the app into a loop through settings pages', async () => {
  await render('/settings/personal', { settingsBackPath: '/settings/overview' });
  expect(container.querySelector('#back')?.getAttribute('href')).toBe('/personal');
});
