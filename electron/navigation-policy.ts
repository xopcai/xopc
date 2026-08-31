import { xopcDeepLinkTarget } from './deep-link.js';
import { normalizeExternalHttpUrl } from './external-url.js';
import { isEmbeddedGatewaySiteShareUrl } from './loopback-url.js';

export type ElectronNavigationDecision =
  | { kind: 'internal-deep-link'; url: string }
  | { kind: 'same-origin'; route: string | null }
  | { kind: 'external-http'; url: string }
  | { kind: 'deny' };

export function decideElectronNavigation(
  currentUrl: string,
  targetUrl: string,
): ElectronNavigationDecision {
  if (xopcDeepLinkTarget(targetUrl)) {
    return { kind: 'internal-deep-link', url: targetUrl };
  }

  try {
    const target = new URL(targetUrl);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return { kind: 'deny' };
    const normalizedTarget = normalizeExternalHttpUrl(targetUrl);
    if (isEmbeddedGatewaySiteShareUrl(normalizedTarget)) {
      return { kind: 'external-http', url: normalizedTarget };
    }

    const current = new URL(currentUrl);
    if (target.origin === current.origin) {
      return {
        kind: 'same-origin',
        route: target.hash.startsWith('#/') ? target.hash.slice(1) : null,
      };
    }
    return { kind: 'external-http', url: normalizedTarget };
  } catch {
    return { kind: 'deny' };
  }
}
