import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { isElectron } from '@/lib/electron-env';
import { openDiscussionCapture } from '@/features/discussions/discussion-events';
import { useSidebarStore } from '@/stores/sidebar-store';

export function ElectronMenuListener() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isElectron()) return;
    const api = window.electronAPI;
    if (!api?.menu) return;

    const offNav = api.menu.onNavigate((path: string) => {
      navigate(path);
    });

    const offPalette = api.menu.onTogglePalette(() => {
      window.dispatchEvent(new CustomEvent('toggle-command-palette'));
    });

    const offQuickCapture = api.menu.onQuickCapture(() => {
      openDiscussionCapture();
    });

    const offSidebar = api.menu.onToggleSidebar(() => {
      useSidebarStore.getState().toggleCollapsed();
    });

    const offHistory = api.menu.onHistoryNavigate((delta) => {
      navigate(delta);
    });

    return () => {
      offNav();
      offPalette();
      offQuickCapture();
      offSidebar();
      offHistory();
    };
  }, [navigate]);

  return null;
}
