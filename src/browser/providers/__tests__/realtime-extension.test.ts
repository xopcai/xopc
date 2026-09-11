import { describe, expect, it, vi } from 'vitest';

import {
  BROWSER_CONTROL_ENDPOINT_DESCRIPTOR,
  BROWSER_CONTROL_ENDPOINT_TOOL_NAME,
} from '@xopcai/browser-control-contract';

import type { EndpointToolRuntime } from '../../../endpoint-tools/index.js';
import { RealtimeExtensionBrowserProvider } from '../realtime-extension.js';

describe('RealtimeExtensionBrowserProvider', () => {
  it('sends browser actions over the authenticated endpoint invocation service', async () => {
    const invoke = vi.fn(async () => ({
      content: [{ type: 'json' as const, value: {
        ok: true,
        receipt: { action: 'navigate', risk: 'read', durationMs: 2, verified: true },
      } }],
    }));
    const endpoint = {
      principalId: 'device-1', endpointId: 'browser:device-1', connectionId: 'connection-1',
      displayName: 'Chrome', kind: 'browser' as const, platform: 'chrome', appVersion: '1.2.3',
      availability: 'background' as const, lastHeartbeatAt: 100,
      tools: [{ descriptor: BROWSER_CONTROL_ENDPOINT_DESCRIPTOR as never, revision: 'revision-1' }],
    };
    const runtime = {
      registry: {
        list: () => [endpoint],
        getTool: (_endpointId: string, name: string) => name === BROWSER_CONTROL_ENDPOINT_TOOL_NAME
          ? endpoint.tools[0]
          : undefined,
      },
      invocations: { invoke },
    } as unknown as EndpointToolRuntime;
    const provider = new RealtimeExtensionBrowserProvider(runtime);

    const result = await provider.send({
      action: 'navigate', sessionId: 'session-1', url: 'https://example.com',
    }, 5_000, true);

    expect(result.result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      endpointId: 'browser:device-1',
      toolName: BROWSER_CONTROL_ENDPOINT_TOOL_NAME,
      descriptorRevision: 'revision-1',
      arguments: {
        input: { action: 'navigate', sessionId: 'session-1', url: 'https://example.com' },
        timeoutMs: 5_000,
        visualFallback: true,
      },
    }));
  });
});
