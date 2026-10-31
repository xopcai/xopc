import { ShellUpstream } from '../shell/upstream.js';
import type { DesktopAuthTransport } from './device-auth.js';
import type { DesktopBinding } from './device-identity.js';

/** Identity proof precedes every enrollment or device credential; redirects are never followed. */
export function desktopAuthTransport(binding: DesktopBinding, transport: 'direct' | 'ssh', lifetime?: AbortSignal) {
  const upstream = new ShellUpstream({ origin: binding.origin, transport, token: 'unused-device-channel',
    identity: { gatewayId: binding.gatewayId, publicKey: binding.publicKey } });
  const request: DesktopAuthTransport = async (path, method, body, headers = {}) => {
    if (!(/^\/api\/device-pairing\/requests(?:\/[0-9a-f-]{36}\/(?:status|complete|cancel))?$/.test(path) && method === 'POST'
      || path === '/api/device-auth/refresh' && method === 'POST'
      || path === '/api/devices/me' && ['GET', 'DELETE'].includes(method))) throw new Error('DESKTOP_AUTH_ROUTE_DENIED');
    const signal = lifetime ? AbortSignal.any([lifetime, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    await upstream.verifyPinnedIdentity(signal);
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    if (bytes && Buffer.byteLength(bytes) > 8192) throw new Error('DESKTOP_AUTH_REQUEST_LIMIT');
    return new Promise((resolve, reject) => {
      const req = upstream.request(path, method, { 'content-type': 'application/json', ...headers }, signal, false);
      req.on('error', () => reject(new Error('DESKTOP_AUTH_NETWORK_FAILED')));
      req.on('response', res => {
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', chunk => { size += chunk.length; if (size > 65536) res.destroy(new Error('DESKTOP_AUTH_RESPONSE_LIMIT')); else chunks.push(chunk); });
        res.on('error', () => reject(new Error('DESKTOP_AUTH_RESPONSE_FAILED')));
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch { reject(new Error('DESKTOP_AUTH_RESPONSE_INVALID')); }
        });
      });
      req.end(bytes);
    });
  };
  return { request, close: () => upstream.close() };
}
