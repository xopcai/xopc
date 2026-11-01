import { randomUUID } from 'node:crypto';

import { REMOTE_BROWSER_DESCRIPTOR } from '@xopcai/browser-control-contract/remote';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { checkBrowserReadiness } from '../../../browser/index.js';
import { createBrowserDriver } from '../../../browser/drivers/create-driver.js';
import { invokeRemoteBrowserCommand } from '../../../browser/remote/endpoint-transport.js';
import { ConfigSchema } from '../../../config/schema.js';
import { closeXopcDatabase } from '../../../storage/sqlite/connection.js';
import { AgentToolsFactory } from '../factory.js';

vi.mock('../../../browser/index.js', async original => ({ ...await original<object>(), checkBrowserReadiness: vi.fn() }));
vi.mock('../../../browser/drivers/create-driver.js', () => ({ createBrowserDriver: vi.fn() }));
vi.mock('../../../browser/remote/endpoint-transport.js', () => ({ invokeRemoteBrowserCommand: vi.fn() }));
beforeAll(() => initializeTestAgentCatalog());
afterAll(() => closeXopcDatabase());
it('routes the public browser_use tool to its explicit independent device without server readiness, setup or driver launch', async () => {
  const owner = randomUUID(), endpointId = randomUUID(), deviceId = randomUUID();
  const endpoint = { endpointId, kind: 'desktop', principalId: deviceId, availability: 'foreground', connectionId: randomUUID(),
    executionAuthority: { gatewayId: randomUUID(), deviceId, grantId: randomUUID(), authorizationRevision: 1,
      connectionInstanceId: randomUUID(), expiresAt: Date.now() + 60000 } };
  const endpoints = { registry: { get: () => endpoint, getTool: () => ({ descriptor: REMOTE_BROWSER_DESCRIPTOR, revision: 'a'.repeat(64) }) } };
  const setup = vi.fn();
  vi.mocked(invokeRemoteBrowserCommand).mockImplementation(async (_runtime, _id, command) => ({ content: [{ type: 'json', value: {
    version: 1, dispatch: 'completed', result: { ok: true, receipt: { action: command.input.action, risk: 'read', durationMs: 0, verified: true,
      ...(command.input.action === 'close' ? {} : { observation: { sessionId: command.sessionId, tabId: 'tab', revision: 1,
        documentId: 'doc', url: 'https://example.com/', title: 'Device fixture', nodes: [], changes: { added: [], changed: [], removed: [] } } }),
    } },
  } }] }));
  const factory = new AgentToolsFactory({ workspace: '/tmp/xopc-device-browser-factory', bus: {} as never, endpointTools: endpoints as never,
    getCurrentContext: () => ({ conversationId: owner, origin: { type: 'endpoint', endpointId } }) as never,
    getConfig: () => ConfigSchema.parse({ browser: { enabled: true } }), getBrowserSetupService: setup });
  const tool = factory.createCoreTools({ conversationId: owner }).find(tool => tool.name === 'browser_use')!;
  const result = await tool.execute('observe', { action: 'observe', visual: 'never' });
  expect(result.details).toMatchObject({ ok: true, receipt: { observation: { title: 'Device fixture' } } });
  expect(invokeRemoteBrowserCommand).toHaveBeenCalledWith(endpoints, endpointId, expect.objectContaining({ owner }), undefined);
  expect(createBrowserDriver).not.toHaveBeenCalled(); expect(checkBrowserReadiness).not.toHaveBeenCalled(); expect(setup).not.toHaveBeenCalled();
  expect(factory.hasBrowserSessions()).toBe(true);
  await factory.closeBrowserPageForSession(owner);
  expect(factory.hasBrowserSessions()).toBe(false);
});
