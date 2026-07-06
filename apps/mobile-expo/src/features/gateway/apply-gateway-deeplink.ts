import type { ImperativeRouter } from 'expo-router';

import { openDefaultSessionAfterConnect } from './navigate-after-gateway-connect';
import { hasPairableGatewayQr, parseGatewayQrPayload } from './parse-gateway-qr';
import { resolveGatewayCredentialsFromQr } from './pair-gateway';
import { upsertGatewayFromPairResult } from './upsert-gateway-from-credentials';

/**
 * Expo / dev-client URLs sometimes embed the real link after `/--/` or in `?url=`.
 * Returns a string suitable for `parseGatewayQrPayload`, or null if none found.
 */
export function extractGatewayLinkCandidate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  const lower = t.toLowerCase();
  const needles = ['xopc://gateway/mobile-connect', 'xopc-mobile://gateway/mobile-connect'] as const;
  for (const needle of needles) {
    const idx = lower.indexOf(needle);
    if (idx >= 0) {
      const slice = t.slice(idx);
      const cut = slice.search(/[\s"'<>[\],;]/);
      return cut === -1 ? slice : slice.slice(0, cut);
    }
  }

  try {
    const u = new URL(t);
    if (u.protocol === 'exp:' || u.protocol === 'exps:') {
      const joined = `${u.pathname}${u.search ?? ''}`;
      const m = joined.match(/\/--\/([^?]*)(\?.*)?/);
      if (m?.[1]) {
        try {
          return decodeURIComponent(m[1]) + (m[2] ?? '');
        } catch {
          return m[1] + (m[2] ?? '');
        }
      }
      const link = u.searchParams.get('url') ?? u.searchParams.get('link');
      if (link) {
        try {
          return decodeURIComponent(link);
        } catch {
          return link;
        }
      }
    }
  } catch {
    /* ignore */
  }

  return null;
}

const inflightDeeplinks = new Map<string, Promise<boolean>>();

/**
 * If `rawUrl` carries a gateway mobile-connect payload, write store, leave Settings (if any), open default session.
 * @returns whether a deep link was consumed
 */
export async function tryConsumeGatewayDeeplink(
  rawUrl: string,
  router: ImperativeRouter,
): Promise<boolean> {
  // On Web, Linking.getInitialURL() returns the current page URL (e.g. http://localhost:8082/).
  // This is NOT a gateway deep link — skip it to prevent writing the dev server origin as baseUrl.
  if (typeof window !== 'undefined') {
    try {
      const current = new URL(window.location.href);
      const incoming = new URL(rawUrl);
      if (incoming.origin === current.origin) return false;
    } catch { /* not a valid URL, continue parsing */ }
  }

  const embedded = extractGatewayLinkCandidate(rawUrl);
  const link = (embedded ?? rawUrl).trim();
  const parsed = parseGatewayQrPayload(link);
  if (!hasPairableGatewayQr(parsed)) return false;

  const inflightKey = `${parsed.baseUrl ?? ''}|${parsed.pairingSecret ?? ''}`;
  const existing = inflightDeeplinks.get(inflightKey);
  if (existing) return existing;

  const work = (async (): Promise<boolean> => {
    let resolved;
    try {
      resolved = await resolveGatewayCredentialsFromQr(parsed);
    } catch (err) {
      if (__DEV__) {
        console.warn('[gateway-deeplink] pairing failed', err);
      }
      return false;
    }
    if (!resolved?.baseUrl) return false;

    await upsertGatewayFromPairResult(resolved);

    await openDefaultSessionAfterConnect(router.replace);
    return true;
  })();

  inflightDeeplinks.set(inflightKey, work);
  try {
    return await work;
  } finally {
    if (inflightDeeplinks.get(inflightKey) === work) inflightDeeplinks.delete(inflightKey);
  }
}
