import { BlockList, isIP } from 'node:net';

import { checkUrlSafety } from '../tools/url-safety.js';

const privateIps = new BlockList();
for (const [prefix, bits] of [['10.0.0.0', 8], ['127.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10]] as const) {
  privateIps.addSubnet(prefix, bits);
}
privateIps.addAddress('::1', 'ipv6');
privateIps.addSubnet('fc00::', 7, 'ipv6');

const blockedIpv6 = new BlockList();
blockedIpv6.addSubnet('::ffff:0:0', 96, 'ipv6');
blockedIpv6.addAddress('::', 'ipv6');
blockedIpv6.addSubnet('fe80::', 10, 'ipv6');
blockedIpv6.addSubnet('ff00::', 8, 'ipv6');

export function mcpHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function isPrivateMcpIp(value: string): boolean {
  const host = mcpHostname(value);
  const family = isIP(host);
  const type = family === 6 ? 'ipv6' : 'ipv4';
  return family !== 0 && host !== '100.100.100.200' &&
    (family !== 6 || !blockedIpv6.check(host, 'ipv6')) && privateIps.check(host, type);
}

export function suggestsPrivateMcpHostname(value: string): boolean {
  const host = mcpHostname(value);
  return isPrivateMcpIp(host) || (isIP(host) === 0 &&
    (!host.includes('.') || /\.(?:localhost|local|lan|internal|home\.arpa)$/.test(host)));
}

export function isPrivateMcpTarget(url: URL): boolean {
  const host = mcpHostname(url.hostname);
  if (host === 'metadata.google.internal' || host === 'metadata.goog') return false;
  return isIP(host) ? isPrivateMcpIp(host) : Boolean(host);
}

export function isPublicMcpTarget(url: URL): boolean {
  const host = mcpHostname(url.hostname);
  const family = isIP(host);
  if (suggestsPrivateMcpHostname(host) || family === 6 && blockedIpv6.check(host, 'ipv6')) return false;
  const normalized = new URL(url);
  if (host !== url.hostname && isIP(host) !== 6) normalized.hostname = host;
  return checkUrlSafety(normalized.href).safe;
}

export function isPublicMcpIp(address: string): boolean {
  return isPublicMcpTarget(new URL(`http://${isIP(address) === 6 ? `[${address}]` : address}`));
}
