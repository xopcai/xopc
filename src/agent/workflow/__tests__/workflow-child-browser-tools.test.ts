import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { BROWSER_CONTROL_ENDPOINT_DESCRIPTOR } from '@xopcai/browser-control-contract';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../config/schema.js';
import type { EndpointToolRuntime } from '../../../endpoint-tools/index.js';
import type { MessageBus } from '../../../infra/bus/index.js';
import { buildWorkflowChildTools } from '../workflow-child-tools.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase } from '../../../storage/sqlite/index.js';

vi.mock('../../../storage/sqlite/browser-tab-binding-repository.js', () => ({
  getBrowserTabBinding: () => undefined,
}));

describe('workflow child browser tools', () => {
  beforeAll(() => initializeTestAgentCatalog());
  afterAll(() => closeXopcDatabase());

  it('uses the parent Session Chrome endpoint through the injected runtime', async () => {
    const parentConversationId = createConversation({ agentId: 'main', sourceChannel: 'webchat' }).key;
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
      conversationId: parentConversationId, endpointId: endpoint.endpointId, boundAt: 1,
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
      browserConversationId: parentConversationId,
    });
    const browser = tools.find((tool) => tool.name === 'browser_use');

    expect(browser).toBeDefined();
    const result = await browser!.execute(
      'call-1',
      { action: 'navigate', url: 'https://example.com' },
      new AbortController().signal,
      undefined as never,
    );

    expect(getBinding).toHaveBeenCalledWith(parentConversationId);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ endpointId: endpoint.endpointId }));
    expect(result.details).toMatchObject({ ok: true });
  });
});
