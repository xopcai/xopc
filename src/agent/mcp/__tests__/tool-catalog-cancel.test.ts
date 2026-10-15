import { beforeEach, expect, it, vi } from 'vitest';
import type { Config } from '../../../config/schema.js';
import { discoverMcpTools } from '../tool-catalog.js';
const native = vi.hoisted(() => ({ prepareNativeMcpConfig: vi.fn(), getNativePiAgentDir: vi.fn() }));
vi.mock('../native-mcp.js', () => native);
beforeEach(() => { vi.clearAllMocks(); });
it('does not prepare or start an already-cancelled MCP connection', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(discoverMcpTools({} as Config, '/fixture', 'docs', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(native.prepareNativeMcpConfig).not.toHaveBeenCalled();
});
it('does not start a connection when it is cancelled while configuration is being prepared', async () => {
  const controller = new AbortController();
  native.prepareNativeMcpConfig.mockImplementationOnce(async () => {
    controller.abort(); return { servers: [{ name: 'docs', config: { command: 'must-not-start' } }], errors: [] };
  });
  await expect(discoverMcpTools({} as Config, '/fixture', 'docs', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(native.getNativePiAgentDir).not.toHaveBeenCalled();
});
