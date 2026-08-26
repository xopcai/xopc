export interface XopcDeepLinkTarget {
  route: string;
  /** Keep live renderer state (for example an in-progress onboarding wizard) intact. */
  focusOnlyWhenReady?: boolean;
}

export function xopcDeepLinkTarget(value: string): XopcDeepLinkTarget | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'xopc:') return null;

    if (url.hostname === 'open') {
      const kind = url.searchParams.get('kind')?.trim();
      const id = url.searchParams.get('id')?.trim();
      if (!kind || !id) return null;
      return { route: `/open?${new URLSearchParams({ kind, id }).toString()}` };
    }

    if (url.hostname === 'settings') {
      const path = url.pathname === '/' ? '' : url.pathname;
      return { route: `/settings${path}${url.search}${url.hash}` };
    }

    if (url.hostname === 'cloud' && url.pathname === '/model-connected') {
      const requestId = url.searchParams.get('request_id')?.trim();
      if (!requestId) return null;
      const returnPath = url.searchParams.get('return_path')?.trim();
      if (
        returnPath &&
        returnPath.length <= 2_048 &&
        returnPath.startsWith('/') &&
        !returnPath.startsWith('//') &&
        !returnPath.includes('\\') &&
        !/[\u0000-\u001f\u007f]/.test(returnPath)
      ) {
        return { route: returnPath, focusOnlyWhenReady: true };
      }
      return { route: '/settings/capabilities/models', focusOnlyWhenReady: true };
    }

    return null;
  } catch {
    return null;
  }
}

export function xopcDeepLinkToRoute(value: string): string | null {
  return xopcDeepLinkTarget(value)?.route ?? null;
}
