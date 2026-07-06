import type { MessageBundle } from '../../i18n/messages';

export type GatewayConnectionKind =
  | 'unconfigured'
  | 'lan'
  | 'tunnel'
  | 'direct'
  | 'indeterminate';

export type GatewayConnectionView = {
  connectionKind: GatewayConnectionKind;
  activeUrl: string;
  activeHost: string;
  lanUrl: string | null;
  tunnelUrl: string;
  lanHost: string | null;
  tunnelHost: string;
  hasLanFallback: boolean;
};

import { normalizeGatewayBaseUrl } from '../../stores/gateway-types';

export { normalizeGatewayBaseUrl };

export function formatGatewayHost(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const u = new URL(withScheme);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    const isDefault =
      (u.protocol === 'https:' && port === '443') || (u.protocol === 'http:' && port === '80');
    return isDefault ? u.hostname : `${u.hostname}:${port}`;
  } catch {
    return trimmed.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

export function deriveGatewayConnectionView(input: {
  baseUrl: string;
  lanUrl: string | null;
  activeBaseUrl: string;
}): GatewayConnectionView {
  const tunnelUrl = normalizeGatewayBaseUrl(input.baseUrl);
  const lanUrl = input.lanUrl ? normalizeGatewayBaseUrl(input.lanUrl) : null;
  const probed = Boolean(input.activeBaseUrl.trim());
  const activeUrl = probed
    ? normalizeGatewayBaseUrl(input.activeBaseUrl)
    : tunnelUrl;

  if (!tunnelUrl) {
    return {
      connectionKind: 'unconfigured',
      activeUrl: '',
      activeHost: '',
      lanUrl: null,
      tunnelUrl: '',
      lanHost: null,
      tunnelHost: '',
      hasLanFallback: false,
    };
  }

  const hasLanFallback = Boolean(lanUrl);
  let connectionKind: GatewayConnectionKind;

  if (!probed && hasLanFallback) {
    connectionKind = 'indeterminate';
  } else if (lanUrl && activeUrl === lanUrl) {
    connectionKind = 'lan';
  } else if (activeUrl === tunnelUrl) {
    connectionKind = hasLanFallback ? 'tunnel' : 'direct';
  } else {
    connectionKind = 'indeterminate';
  }

  return {
    connectionKind,
    activeUrl,
    activeHost: formatGatewayHost(activeUrl),
    lanUrl,
    tunnelUrl,
    lanHost: lanUrl ? formatGatewayHost(lanUrl) : null,
    tunnelHost: formatGatewayHost(tunnelUrl),
    hasLanFallback,
  };
}

export function connectionKindLabel(
  kind: GatewayConnectionKind,
  g: MessageBundle['gateway'],
): string {
  switch (kind) {
    case 'lan':
      return g.connectionCurrentLan;
    case 'tunnel':
      return g.connectionCurrentTunnel;
    case 'direct':
      return g.connectionCurrentDirect;
    case 'indeterminate':
      return g.connectionDetecting;
    case 'unconfigured':
      return g.connectionUnconfigured;
  }
}
