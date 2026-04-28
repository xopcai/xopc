import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { isElectron } from '@/lib/electron-env';

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

    return () => {
      offNav();
      offPalette();
    };
  }, [navigate]);

  return null;
}
