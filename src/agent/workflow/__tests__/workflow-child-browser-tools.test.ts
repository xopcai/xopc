import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { BROWSER_CONTROL_ENDPOINT_DESCRIPTOR } from '@xopcai/browser-control-contract';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../config/schema.js';
import type { EndpointToolRuntime } from '../../../endpoint-tools/index.js';
import type { MessageBus } from '../../../infra/bus/index.js';
import { buildWorkflowChildTools } from '../workflow-child-tools.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase } from '../../../storage/sqlite/index.js';
import { runInIndependentAgentExecution } from '../../independent-execution.js';
import { withDataToolPermissions } from '../../tools/dataBatch.js';
import { createNoninteractiveToolPolicy } from '../../tools/noninteractive-tool-policy.js';

vi.mock('../../../storage/sqlite/browser-tab-binding-repository.js', () => ({
  getBrowserTabBinding: () => undefined,
}));

describe('workflow child browser tools', () => {
  beforeAll(() => initializeTestAgentCatalog({ agents: [
    { id: 'main', tools: { web_search: { mode: 'deny' } } },
    { id: 'researcher', tools: { web_search: { mode: 'allow' } }, toolAllowlist: ['web_search', 'data_batch'] },
    { id: 'restricted', tools: { web_search: { mode: 'deny' } }, toolAllowlist: ['data_batch'] },
  ] }));
  afterAll(() => closeXopcDatabase());
  afterEach(() => vi.unstubAllGlobals());

  it.each(['researcher', 'restricted'])('uses %s permissions for both direct search and batching', async agentId => {
    const conversationId = createConversation({ agentId, sourceChannel: 'workflow' }).key;
    const getConfig = () => ConfigSchema.parse({ tools: { web: { search: {
      region: 'global', providers: [{ type: 'brave', apiKey: 'test' }],
    } } } });
    const fetch = vi.fn(async () => Response.json({ web: { results: [
      { title: 'Exhibition', url: 'https://example.com/exhibition', description: 'Open today' },
    ] } }));
    vi.stubGlobal('fetch', fetch);
    const permitted = agentId === 'researcher';
    await withDataToolPermissions(new Set(permitted ? [] : ['web_search']), () =>
      runInIndependentAgentExecution(async () => {
        const tools = buildWorkflowChildTools({ workspace: '/tmp', bus: {} as MessageBus,
          model: { provider: 'openai', id: 'test', input: ['text'] } as never,
          getConfig, agentId, conversationId });
        expect(tools.map(tool => tool.name)).toEqual(permitted ? ['data_batch', 'web_search'] : ['data_batch']);
        const search = tools.find(tool => tool.name === 'web_search');
        if (search) expect((await search.execute('direct', { query: 'exhibitions' })).details).not.toMatchObject({ status: 'failed' });
        const batch = await tools.find(tool => tool.name === 'data_batch')!.execute('batch', {
          operations: [{ id: 's', kind: 'web_search', query: 'market' }],
        });
        expect(batch.details).toMatchObject({ status: permitted ? 'completed' : 'failed', sourceRequests: permitted ? 1 : 0 });
        const decision = await createNoninteractiveToolPolicy({ getConfig, agentId }).beforeToolCall({
          toolCall: { name: 'web_search', arguments: { query: 'exhibitions' }, id: 'policy' },
          args: { query: 'exhibitions' },
        } as never);
        expect(Boolean(decision?.block)).toBe(!permitted);
      }));
    expect(fetch).toHaveBeenCalledTimes(permitted ? 2 : 0);
  });

  it('uses the executing Session Chrome endpoint through the injected runtime', async () => {
    const conversationId = createConversation({ agentId: 'main', sourceChannel: 'workflow' }).key;
    const endpoint = {
      principalId: 'device-1', endpointId: 'browser:device-1', connectionId: 'connection-1',
      displayName: 'Chrome', kind: 'browser' as const, platform: 'chrome', appVersion: '1.0.0',
      availability: 'background' as const, lastHeartbeatAt: Date.now(),
      tools: [{ descriptor: BROWSER_CONTROL_ENDPOINT_DESCRIPTOR as never, revision: 'revision-1' }],
    };
    const invoke = vi.fn(async () => ({ content: [{ type: 'json' as const, value: {
      ok: true,
      receipt: { action: 'navigate', risk: 'read', durationMs: 1, verified: true },
    } }] }));
    const getBinding = vi.fn(() => ({
      conversationId, endpointId: endpoint.endpointId, boundAt: 1,
    }));
    const endpointTools = {
      registry: {
        list: () => [endpoint],
        get: (endpointId: string) => endpointId === endpoint.endpointId ? endpoint : undefined,
        getTool: (endpointId: string) => endpointId === endpoint.endpointId ? endpoint.tools[0] : undefined,
      },
      bindings: { get: getBinding },
      invocations: { invoke },
    } as unknown as EndpointToolRuntime;
    const tools = buildWorkflowChildTools({
      workspace: '/tmp/xopc-workflow-child-browser',
      bus: {} as MessageBus,
      model: { provider: 'openai', id: 'test', input: ['text'] } as never,
      getConfig: () => ConfigSchema.parse({ browser: { enabled: true, driver: { kind: 'extension' } } }),
      endpointTools,
      agentId: 'main',
      conversationId,
    });
    const browser = tools.find((tool) => tool.name === 'browser_use');

    expect(browser).toBeDefined();
    const result = await browser!.execute(
      'call-1',
      { action: 'navigate', url: 'https://example.com' },
      new AbortController().signal,
      undefined as never,
    );

    expect(getBinding).toHaveBeenCalledWith(conversationId);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ endpointId: endpoint.endpointId }));
    expect(result.details).toMatchObject({ ok: true });
  });
});
