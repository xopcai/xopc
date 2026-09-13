import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { isLoopbackHost } from '../host.js';

function origin(c: Context): URL {
  return new URL(`http://${c.req.header('host') ?? new URL(c.req.url).host}`);
}
function secure(c: Context): boolean { return !isLoopbackHost(origin(c).hostname.replace(/^\[|\]$/g, '')); }
function name(c: Context): string { return secure(c) ? '__Host-xopc-session' : 'xopc-local-session'; }
export function readBrowserSessionCookie(c: Context): string | undefined { return getCookie(c, name(c)); }
export function browserCookieRequestAllowed(c: Context): boolean {
  const requestOrigin = c.req.header('origin');
  if (requestOrigin) {
    try {
      const parsed = new URL(requestOrigin);
      const localOrigin = isLoopbackHost(parsed.hostname.replace(/^\[|\]$/g, ''));
      return (parsed.host === origin(c).host || (!secure(c) && localOrigin)) && (parsed.protocol === 'https:' || (!secure(c) && parsed.protocol === 'http:'));
    } catch { return false; }
  }
  return ['GET', 'HEAD'].includes(c.req.method) && c.req.header('sec-fetch-site') !== 'cross-site';
}
export function writeBrowserSessionCookie(c: Context, token: string, expiresAt: number): void {
  setCookie(c, name(c), token, { httpOnly: true, secure: secure(c), sameSite: 'Strict', path: '/', expires: new Date(expiresAt) });
}
export function clearBrowserSessionCookie(c: Context): void {
  deleteCookie(c, name(c), { httpOnly: true, secure: secure(c), sameSite: 'Strict', path: '/' });
}
