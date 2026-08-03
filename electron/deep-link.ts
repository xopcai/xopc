export function xopcDeepLinkToRoute(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'xopc:') return null;

    if (url.hostname === 'open') {
      const kind = url.searchParams.get('kind')?.trim();
      const id = url.searchParams.get('id')?.trim();
      if (!kind || !id) return null;
      return `/open?${new URLSearchParams({ kind, id }).toString()}`;
    }

    if (url.hostname === 'settings') {
      const path = url.pathname === '/' ? '' : url.pathname;
      return `/settings${path}${url.search}${url.hash}`;
    }

    if (url.hostname === 'cloud' && url.pathname === '/model-connected') {
      const requestId = url.searchParams.get('request_id')?.trim();
      if (!requestId) return null;
      return '/settings/capabilities/models';
    }

    return null;
  } catch {
    return null;
  }
}
