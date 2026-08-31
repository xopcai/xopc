import {
  parseProductReferenceDeepLink,
  productReferenceOpenRoute,
} from '@xopcai/gateway-contract';

const INTERNAL_ROUTE_ROOTS = new Set([
  'agents',
  'automations',
  'browser-workflows',
  'channels',
  'chat',
  'connectors',
  'extensions',
  'local-apps',
  'notes',
  'onboarding',
  'open',
  'projects',
  'settings',
  'skills',
  'tasks',
  'workflows',
  'you',
]);

export type AppLinkIntent =
  | { kind: 'internal-route'; route: string }
  | { kind: 'external-http'; url: string }
  | { kind: 'blocked' };

function normalizeInternalRoute(raw: string): string | null {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  const root = raw.slice(1).split(/[/?#]/, 1)[0] ?? '';
  return root && INTERNAL_ROUTE_ROOTS.has(root) ? raw : null;
}

function xopcSettingsRoute(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'xopc:' || url.hostname !== 'settings') return null;
    const path = url.pathname === '/' ? '' : url.pathname;
    return normalizeInternalRoute(`/settings${path}${url.search}${url.hash}`);
  } catch {
    return null;
  }
}

export function resolveAppLink(raw: string, currentHref = window.location.href): AppLinkIntent {
  const href = raw.trim();
  if (!href) return { kind: 'blocked' };

  const productReference = parseProductReferenceDeepLink(href);
  if (productReference) {
    const route = productReferenceOpenRoute({
      ...productReference,
      title: productReference.id,
      capabilities: ['open'],
    });
    return route ? { kind: 'internal-route', route } : { kind: 'blocked' };
  }

  const settingsRoute = xopcSettingsRoute(href);
  if (settingsRoute) return { kind: 'internal-route', route: settingsRoute };

  if (href.startsWith('#/')) {
    const route = normalizeInternalRoute(href.slice(1));
    return route ? { kind: 'internal-route', route } : { kind: 'blocked' };
  }

  if (href.startsWith('/')) {
    const route = normalizeInternalRoute(href);
    return route ? { kind: 'internal-route', route } : { kind: 'blocked' };
  }

  try {
    const url = new URL(href, currentHref);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'blocked' };
    if (url.username || url.password) return { kind: 'blocked' };

    const current = new URL(currentHref);
    if (url.origin === current.origin && url.hash.startsWith('#/')) {
      const route = normalizeInternalRoute(url.hash.slice(1));
      if (route) return { kind: 'internal-route', route };
    }
    return { kind: 'external-http', url: url.toString() };
  } catch {
    return { kind: 'blocked' };
  }
}

export function decorateAppLinks(root: HTMLElement): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const intent = resolveAppLink(anchor.getAttribute('href') ?? '');
    anchor.dataset.xopcLinkKind = intent.kind;
    if (intent.kind !== 'external-http') continue;
    anchor.target = '_blank';
    const rel = new Set(anchor.rel.split(/\s+/).filter(Boolean));
    rel.add('noopener');
    rel.add('noreferrer');
    anchor.rel = [...rel].join(' ');
  }
}

export type OpenExternalHttpLinkResult = { ok: true } | { ok: false; error: string };

export async function openExternalHttpLink(url: string): Promise<OpenExternalHttpLinkResult> {
  const intent = resolveAppLink(url);
  if (intent.kind !== 'external-http') {
    return { ok: false, error: 'Only external HTTP(S) links can be opened' };
  }

  const electronOpen = window.electronAPI?.shell?.openExternalUrl;
  if (electronOpen) {
    return electronOpen(intent.url);
  }

  window.open(intent.url, '_blank', 'noopener,noreferrer');
  return { ok: true };
}

export function rewriteSupportedAppLinksInMarkdown(markdown: string): string {
  const xopcUrlPattern = String.raw`xopc:\/\/(?:settings|open\?)[^\s[\]()<>"']*`;
  const markdownLinkPattern = new RegExp(String.raw`\[([^\]\n]*)\]\((${xopcUrlPattern})\)`, 'gi');
  const bareUrlPattern = new RegExp(xopcUrlPattern, 'gi');
  const rewrite = (raw: string): string => {
    const intent = resolveAppLink(raw);
    return intent.kind === 'internal-route' ? `#${intent.route}` : raw;
  };
  const rewrittenLinks = markdown.replace(markdownLinkPattern, (_match, label: string, raw: string) => {
    const normalizedLabel = /^xopc:\/\//i.test(label.trim()) ? 'Open in xopc' : label;
    return `[${normalizedLabel}](${rewrite(raw)})`;
  });
  return rewrittenLinks.replace(bareUrlPattern, rewrite);
}
