import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useRightWorkspaceStore, type WorkspacePane } from '@/stores/right-workspace-store';

/** UI history restores selection only; it never closes resources or recreates side chats. */
export function useWorkspaceNavigation(scope: string, pane: WorkspacePane, enabled: boolean) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const previous = useRef<{ pathname: string; search: string; scope: string } | null>(null);
  const written = useRef<string | null>(null);
  const applying = useRef(false);

  useEffect(() => {
    const normalized = new URLSearchParams(search).toString();
    const before = previous.current;
    previous.current = { pathname, search, scope };
    if (before?.pathname === pathname && before.scope === scope && before.search === search) return;
    if (written.current === `${pathname}?${normalized}`) { written.current = null; return; }
    const params = new URLSearchParams(search);
    const id = params.get('workspaceTab');
    const changed = before?.pathname === pathname && before.scope === scope
      && new URLSearchParams(before.search).get('workspaceTab') !== id;
    if ((id && pane.tabs.some((tab) => tab.id === id) && id !== pane.activeId) || changed) {
      applying.current = true;
      const state = useRightWorkspaceStore.getState();
      if (id && pane.tabs.some((tab) => tab.id === id)) state.activate(id, scope);
      else if (pane.activeId !== null) state.activate(null, scope);
    }
  }, [pane.activeId, pane.tabs, pathname, scope, search]);

  useEffect(() => {
    if (!enabled) return;
    if (applying.current) { applying.current = false; return; }
    const params = new URLSearchParams(search);
    if (pane.open && pane.activeId) params.set('workspaceTab', pane.activeId);
    else params.delete('workspaceTab');
    const normalized = params.toString();
    if (normalized === new URLSearchParams(search).toString()) return;
    written.current = `${pathname}?${normalized}`;
    navigate({ pathname, search: normalized ? `?${normalized}` : '' });
  }, [enabled, navigate, pane.activeId, pane.open, pathname, search]);
}
