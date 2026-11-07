import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { resolveSettingsBackTarget, SETTINGS_BACK_PATH_STATE_KEY } from './settings-nav-state';

/** Retain one application origin across settings tabs, refreshes and overlay closing. */
export function useSettingsNavigationOrigin() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastApplicationPath = useRef<string | null>(null);
  const settingsOrigin = useRef<string | null>(null);

  useEffect(() => {
    if (!/^\/settings(?:\/|$)/u.test(location.pathname)) {
      lastApplicationPath.current = `${location.pathname}${location.search}${location.hash}`;
      settingsOrigin.current = null;
      return;
    }
    const state = location.state && typeof location.state === 'object' ? location.state as Record<string, unknown> : {};
    const raw = state[SETTINGS_BACK_PATH_STATE_KEY];
    const explicit = typeof raw === 'string' && raw.trim() === resolveSettingsBackTarget(state) ? raw.trim() : undefined;
    const target = explicit ?? settingsOrigin.current ?? lastApplicationPath.current
      ?? (location.pathname === '/settings/personal' ? '/personal' : '/chat');
    settingsOrigin.current = target;
    if (explicit === target) return;
    navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, {
      replace: true, state: { ...state, [SETTINGS_BACK_PATH_STATE_KEY]: target },
    });
  }, [location, navigate]);
}
