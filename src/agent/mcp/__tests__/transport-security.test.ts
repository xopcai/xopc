import { McpClient } from '@earendil-works/pi-mcp';
import { expect, it, vi } from 'vitest';

vi.mock('node:dns', () => ({ lookup: (_host: string, _options: unknown, callback: (error: unknown, addresses: unknown[]) => void) => callback(null, [{ address: '127.0.0.1', family: 4 }]) }));
import { createXopcMcpTransport } from '../transport.js';

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
