import { expect, it } from 'vitest';
import { startConnectorAuthorization } from '../auth-provider-registry.js';
it('rejects connectors without OAuth', async () => {
  await expect(startConnectorAuthorization({ id: 'plain', auth: { mode: 'none' } } as never)).rejects.toThrow('does not use OAuth');
});
it('does not implement a second MCP OAuth authorization flow', async () => {
  await expect(startConnectorAuthorization({ id: 'native', auth: { mode: 'oauth' }, runtime: { type: 'mcp' } } as never)).rejects.toThrow('does not support OAuth authorization');
});
