import { isIP } from 'node:net';

export type ConnectorEndpointPolicy = { domains: string[]; pathPrefixes?: string[]; encodeValue?: boolean };

export function validEndpointDomain(domain: string): boolean {
  return /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)
    && !domain.endsWith('.localhost') && !domain.endsWith('.local');
}

export function assertConnectorEndpoint(value: string, policy: ConnectorEndpointPolicy): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || isIP(host)
    || !policy.domains.length || policy.domains.some(domain => !validEndpointDomain(domain))
    || !policy.domains.some(domain => domain.startsWith('*.')
      ? host.endsWith(domain.slice(1)) && host !== domain.slice(2) : host === domain.toLowerCase())) {
    throw new Error('Connector endpoint must use HTTPS on a declared provider domain.');
  }
  if (policy.pathPrefixes?.length && !policy.pathPrefixes.some(prefix => url.pathname === prefix || url.pathname.startsWith(`${prefix.replace(/\/$/, '')}/`))) {
    throw new Error('Connector endpoint is outside the declared MCP path.');
  }
  return value;
}
