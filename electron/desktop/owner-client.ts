import { ShellUpstream } from '../shell/upstream.js';
import type { RemoteTarget } from '../shell/upstream.js';

/** Main-only, bounded owner calls always re-prove the pinned Gateway before sending credentials. */
export function desktopOwnerClient(target: RemoteTarget, lifetime: AbortSignal) {
  const upstream = new ShellUpstream(target);
  return { close: () => upstream.close(), request: async (path: string, method = 'GET', body?: unknown): Promise<any> => {
    if (!(path === '/api/desktop-host/compatibility' && method === 'GET'
      || /^\/api\/desktop-host\/devices\/[0-9a-f-]{36}\/observation$/.test(path) && ['GET', 'POST'].includes(method))) throw new Error('DESKTOP_OWNER_ROUTE_DENIED');
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(15000)]);
    await upstream.verifyPinnedIdentity(signal);
    return new Promise((resolve, reject) => {
      const req = upstream.request(path, method, { 'content-type': 'application/json' }, signal);
      req.on('error', () => reject(new Error('DESKTOP_AUTH_UNAVAILABLE')));
      req.on('response', res => {
        if (![200, 201].includes(res.statusCode ?? 0)) { res.destroy(); reject(new Error(res.statusCode === 404 ? 'DESKTOP_HOST_UNSUPPORTED' : res.statusCode === 409 ? 'DESKTOP_OBSERVATION_REVISION_CHANGED' : [401, 403].includes(res.statusCode ?? 0) ? 'DESKTOP_OWNER_AUTH_REQUIRED' : 'DESKTOP_AUTH_UNAVAILABLE')); return; }
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', chunk => { size += chunk.length; if (size > 65536) res.destroy(new Error('DESKTOP_RESPONSE_LIMIT')); else chunks.push(chunk); });
        res.on('error', () => reject(new Error('DESKTOP_AUTH_UNAVAILABLE')));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error('DESKTOP_AUTH_UNAVAILABLE')); } });
      });
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  } };
}
