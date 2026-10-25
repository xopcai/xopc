// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { EMPTY_WORKSPACE_PANE, useRightWorkspaceStore as workspace } from '@/stores/right-workspace-store';
import { useWorkspaceNavigation } from '../workspace-navigation';

function Harness() {
  const pane = workspace((s) => s.panes.parent ?? EMPTY_WORKSPACE_PANE);
  const location = useLocation();
  const navigate = useNavigate();
  useWorkspaceNavigation('parent', pane, true);
  return <><output>{location.search}</output><button onClick={() => navigate(-1)}>Back</button></>;
}
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  workspace.getState().reset(); workspace.getState().setScope('parent');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); window.history.replaceState(null, '', window.location.pathname); });

it('does not overwrite a newer hash route with a delayed workspace update', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/automations?automation=old']}><Harness /></MemoryRouter>));
  window.history.replaceState(null, '', '#/automations?automation=new');
  await act(async () => workspace.getState().openTools());
  expect(container.querySelector('output')?.textContent).toBe('?automation=old');
  expect(window.location.hash).toBe('#/automations?automation=new');
});

it('keeps collapse closed when its own URL update arrives', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/chat/parent']}><Harness /></MemoryRouter>));
  let id = '';
  await act(async () => { id = workspace.getState().openFile({ path: 'report.md' }); });
  expect(container.textContent).toContain(id);
  await act(async () => workspace.getState().setOpen(false));
  expect(workspace.getState().panes.parent.open).toBe(false);
  expect(container.querySelector('output')?.textContent).toBe('');
  expect(workspace.getState().panes.parent.tabs).toHaveLength(1);
});

it('restores selection with browser back without removing either file', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/chat/parent']}><Harness /></MemoryRouter>));
  let a = '';
  await act(async () => { a = workspace.getState().openFile({ path: 'a.md' }); });
  await act(async () => { workspace.getState().keepFileOpen(a); workspace.getState().openFile({ path: 'b.md' }); });
  await act(async () => container.querySelector('button')!.click());
  expect(workspace.getState().panes.parent.activeId).toBe(a);
  expect(workspace.getState().panes.parent.tabs).toHaveLength(2);
});

it('returns to the closed workspace before its first tab without showing files', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/chat/parent']}><Harness /></MemoryRouter>));
  let id = '';
  await act(async () => { id = workspace.getState().openTools(); });
  await act(async () => container.querySelector('button')!.click());
  expect(workspace.getState().panes.parent).toMatchObject({ open: false, activeId: id, tabs: [{ id, kind: 'home' }] });
});

it('keeps the last tab closed when navigating back to its stale URL', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/chat/parent']}><Harness /></MemoryRouter>));
  await act(async () => workspace.getState().openTools());
  await act(async () => workspace.getState().remove(workspace.getState().panes.parent.activeId!));
  await act(async () => container.querySelector('button')!.click());
  expect(workspace.getState().panes.parent).toEqual({ open: false, activeId: null, tabs: [] });
});
