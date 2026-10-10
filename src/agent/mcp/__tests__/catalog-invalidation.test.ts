import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ clients: [] as Array<{ onclose?: () => void; notify?: () => void; close: ReturnType<typeof vi.fn> }>,
  tools: [{ name: 'lookup', inputSchema: { type: 'object' } }], failed: false }));
vi.mock('../embedded-mcp.js', () => ({ loadEmbeddedMcpConfig: () => ({ mcpServers: { docs: {} }, diagnostics: [] }) }));
vi.mock('../mcp-transport.js', () => ({ resolveMcpTransport: async () => ({ transport: { close: async () => {} }, description: 'local', transportType: 'stdio', requestTimeoutMs: 1000, connectionTimeoutMs: 1000 }) }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: class {
  onclose?: () => void;
  notify?: () => void;
  close = vi.fn(async () => { this.onclose?.(); });
  constructor() { state.clients.push(this); }
  async connect() { if (state.failed) throw new Error('not ready'); }
  async listTools() { return { tools: state.tools }; }
  async listResources() { return { resources: [] }; }
  async listPrompts() { return { prompts: [] }; }
  setNotificationHandler(_schema: unknown, listener: () => void) { this.notify = listener; }
} }));

import { createSessionMcpRuntime } from '../bundle-mcp-runtime.js';

it('refreshes changed and disconnected catalogs through the same runtime and notifies deferred runners', async () => {
  const runtime = createSessionMcpRuntime({ sessionId: 'catalog-test', workspaceDir: '/tmp' });
  const invalidated = vi.fn();
  runtime.onCatalogInvalidated?.(invalidated);
  try {
    const first = await runtime.getCatalog();
    state.tools = [{ name: 'replacement', inputSchema: { type: 'object' } }];
    state.clients.at(-1)?.notify?.();
    expect(invalidated).toHaveBeenCalledTimes(1);
    const changed = await runtime.getCatalog();
    expect(changed.version).toBeGreaterThan(first.version);
    expect(changed.tools.map(tool => tool.toolName)).toEqual(['replacement']);
    expect(invalidated).toHaveBeenCalledTimes(1);
    state.clients.at(-1)?.onclose?.();
    expect(invalidated).toHaveBeenCalledTimes(2);
    expect((await runtime.getCatalog()).tools).toHaveLength(1);
    expect(state.clients).toHaveLength(3);
  } finally { await runtime.dispose(); }
  expect(invalidated).toHaveBeenCalledTimes(2);
});

it('retries a previously unavailable server after a bounded failed-catalog cache interval', async () => {
  state.failed = true;
  const runtime = createSessionMcpRuntime({ sessionId: 'catalog-retry', workspaceDir: '/tmp' });
  const now = Date.now();
  try {
    const failed = await runtime.getCatalog();
    expect(failed.tools).toEqual([]);
    const attempts = state.clients.length;
    state.failed = false;
    expect(await runtime.getCatalog()).toBe(failed);
    expect(state.clients).toHaveLength(attempts);
    vi.spyOn(Date, 'now').mockReturnValue(now + 6000);
    expect((await runtime.getCatalog()).tools).toHaveLength(1);
  } finally { vi.restoreAllMocks(); state.failed = false; await runtime.dispose(); }
});
