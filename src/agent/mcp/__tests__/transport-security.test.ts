import { McpClient } from '@earendil-works/pi-mcp';
import { expect, it, vi } from 'vitest';

vi.mock('node:dns', () => ({ lookup: (host: string, _options: unknown, callback: (error: unknown, addresses: unknown[]) => void) =>
  callback(null, [{ address: host === 'lan.example.com' ? '192.0.2.1' : '127.0.0.1', family: 4 }]) }));
import { createXopcMcpTransport } from '../transport.js';
import { isPrivateMcpTarget, isPublicMcpTarget } from '../network-policy.js';

it('rejects a public-looking discovered host resolving to a private address before sending credentials', async () => {
  const client = new McpClient({ name: 'test', version: '1', requestTimeoutMs: 1000 });
  const transport = createXopcMcpTransport({ probe: true })({ name: 'public-looking', config: { type: 'http', url: 'http://public-looking.example:12345/mcp', headers: { 'X-API-Key': 'must-not-send' }, xopcPublicOnly: true } as any, source: 'test', scope: 'extension' }, process.cwd(), undefined);
  try { await expect(client.connect(transport)).rejects.toThrow(); }
  finally { await client.close(); }
}, 5000);

it('rejects an explicitly private search-discovered endpoint before protocol IO', async () => {
  const client = new McpClient({ name: 'test', version: '1', requestTimeoutMs: 1000 });
  const observed = vi.fn();
  const transport = createXopcMcpTransport({ probe: true, observe: observed })({ name: 'private', config: { type: 'http', url: 'http://169.254.169.254/credentials', xopcPublicOnly: true } as any, source: 'test', scope: 'extension' }, process.cwd(), undefined);
  try { await expect(client.connect(transport)).rejects.toThrow(); expect(observed).not.toHaveBeenCalled(); }
  finally { await client.close(); }
}, 5000);

it('checks private IPv4 and IPv6 ranges without accepting metadata or mapped addresses', () => {
  for (const address of ['127.0.0.1', '192.168.1.4', '10.1.2.3', '[::1]', '[fd12::1]']) {
    const url = new URL(`http://${address}/mcp`);
    expect(isPrivateMcpTarget(url)).toBe(true);
    expect(isPublicMcpTarget(url)).toBe(false);
  }
  for (const address of ['169.254.169.254', '100.100.100.200', 'metadata.google.internal.', '[::ffff:7f00:1]', '[fe90::1]']) {
    const url = new URL(`http://${address}/mcp`);
    expect(isPrivateMcpTarget(url)).toBe(false);
    expect(isPublicMcpTarget(url)).toBe(false);
  }
});

it('keeps a private DNS name within the reviewed network before sending requests', async () => {
  const client = new McpClient({ name: 'test', version: '1', requestTimeoutMs: 1000 });
  const observed = vi.fn();
  const transport = createXopcMcpTransport({ probe: true, observe: observed })({ name: 'lan',
    config: { type: 'http', url: 'http://lan.example.com:12345/mcp', xopcPrivateNetwork: true } as any,
    source: 'test', scope: 'extension' }, process.cwd(), undefined);
  try {
    await expect(client.connect(transport)).rejects.toThrow();
    expect(observed).not.toHaveBeenCalled();
  } finally { await client.close(); }
}, 5000);
