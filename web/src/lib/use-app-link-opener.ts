import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { withDetailReturnTo } from './navigation-return';
import { openExternalHttpLink, resolveAppLink } from './app-link';

export type OpenAppLinkResult =
  | { ok: true; kind: 'internal-route' | 'external-http' }
  | { ok: false; error: string };

export function useAppLinkOpener() {
  const location = useLocation();
  const navigate = useNavigate();

  return useCallback(async (href: string): Promise<OpenAppLinkResult> => {
    const intent = resolveAppLink(href);
    if (intent.kind === 'internal-route') {
      navigate(withDetailReturnTo(intent.route, `${location.pathname}${location.search}`));
      return { ok: true, kind: intent.kind };
    }
    if (intent.kind === 'external-http') {
      const result = await openExternalHttpLink(intent.url);
      return result.ok ? { ok: true, kind: intent.kind } : result;
    }
    return { ok: false, error: 'Unsupported link' };
  }, [location.pathname, location.search, navigate]);
}
