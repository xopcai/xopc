import { lookup } from 'node:dns';
import { isIP, BlockList } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';

const blocked = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(network, prefix);
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(network, prefix, 'ipv6');
const isBlocked = (address: string) => blocked.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
const loopback = (host: string) => host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);

// Validate at socket lookup time so a second DNS lookup cannot bypass the decision.
const publicDispatcher = new Agent({ connect: { lookup(host, options, callback) {
  lookup(host, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    if (!addresses.length || addresses.some(entry => isBlocked(entry.address))) return callback(new Error('Plugin MCP cannot access private network addresses'), []);
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
} } });

export function createPluginHttpFetch(endpoint: URL, configuredHeaders: Record<string, string>): FetchLike {
  return async (input, init) => {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Invalid plugin MCP request URL');
    const local = loopback(endpoint.hostname) && url.origin === endpoint.origin;
    if (!local && url.protocol !== 'https:') throw new Error('Plugin MCP requires HTTPS');
    const address = url.hostname.replace(/^\[|\]$/g, '');
    if (!local && isIP(address) && isBlocked(address)) throw new Error('Plugin MCP cannot access private network addresses');
    const headers = new Headers(url.origin === endpoint.origin ? configuredHeaders : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    // A redirect is a connection error, not implicit permission to forward credentials.
    return await undiciFetch(url, {
      ...init, headers, redirect: 'error', ...(local ? {} : { dispatcher: publicDispatcher }),
    } as unknown as Parameters<typeof undiciFetch>[1]) as unknown as Response;
  };
}
