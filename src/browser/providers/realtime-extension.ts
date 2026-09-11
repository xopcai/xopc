import crypto from 'node:crypto';

import {
  BROWSER_CONTROL_ENDPOINT_TOOL_NAME,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  type BrowserActionInput,
  type BrowserWireResult,
} from '@xopcai/browser-control-contract';

import type { EndpointToolRuntime } from '../../endpoint-tools/index.js';
import { getBrowserTabBindingById } from '../../storage/sqlite/browser-tab-binding-repository.js';

export interface RealtimeExtensionProviderConfig {
  connectionTimeout?: number;
  commandTimeout?: number;
}

export class RealtimeExtensionBrowserProvider {
  readonly name = 'extension';
  private readonly connectionTimeout: number;
  private readonly commandTimeout: number;

  constructor(
    private readonly runtime: EndpointToolRuntime,
    config: RealtimeExtensionProviderConfig = {},
  ) {
    this.connectionTimeout = config.connectionTimeout ?? 30_000;
    this.commandTimeout = config.commandTimeout ?? 30_000;
  }

  async start(): Promise<void> {}

  async waitForConnection(timeoutMs = this.connectionTimeout): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.currentEndpoint()) {
      if (Date.now() >= deadline) {
        throw new Error(`Extension connection timeout after ${timeoutMs}ms. Open the xopc Chrome extension and connect it to this Gateway.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  async send(input: BrowserActionInput, timeoutMs = this.commandTimeout, visualFallback = true): Promise<BrowserWireResult> {
    const endpoint = this.endpointForInput(input);
    if (!endpoint) throw new Error('Extension not connected to this Gateway. Open the xopc Chrome extension and connect it first.');
    const tool = this.runtime.registry.getTool(endpoint.endpointId, BROWSER_CONTROL_ENDPOINT_TOOL_NAME);
    if (!tool) throw new Error('Connected browser extension does not support authenticated Realtime browser control. Reload or update the extension.');
    const id = crypto.randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.runtime.invocations.invoke({
        endpointId: endpoint.endpointId,
        toolCallId: `browser-control:${id}`,
        toolName: tool.descriptor.name,
        arguments: { input, timeoutMs, visualFallback },
        descriptorRevision: tool.revision,
        signal: controller.signal,
      });
      const value = response.content.find((item) => item.type === 'json');
      if (!value || !value.value || typeof value.value !== 'object') {
        throw new Error('Browser extension returned an invalid Realtime result');
      }
      return { id, connectionId: endpoint.endpointId, result: value.value as BrowserWireResult['result'] };
    } finally {
      clearTimeout(timer);
    }
  }

  isConnected(): boolean {
    return Boolean(this.currentEndpoint());
  }

  getConnectionStatus() {
    const endpoint = this.currentEndpoint();
    return {
      socketConnected: Boolean(endpoint),
      connected: Boolean(endpoint),
      protocolVersion: endpoint ? BROWSER_EXTENSION_PROTOCOL_VERSION : null,
      expectedProtocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: endpoint?.appVersion ?? null,
      principalId: endpoint?.principalId ?? null,
      transport: 'gateway-realtime' as const,
    };
  }

  async shutdown(): Promise<void> {}

  private endpointForInput(input: BrowserActionInput) {
    if (input.target?.kind === 'attached_tab') {
      const binding = getBrowserTabBindingById(input.target.bindingId);
      const endpoint = binding ? this.runtime.registry.get(binding.endpointId) : undefined;
      if (!binding || !endpoint || endpoint.principalId !== binding.principalId) return undefined;
      return endpoint;
    }
    return this.currentEndpoint();
  }

  private currentEndpoint() {
    return this.runtime.registry.list()
      .filter((endpoint) => endpoint.kind === 'browser'
        && endpoint.tools.some((tool) => tool.descriptor.name === BROWSER_CONTROL_ENDPOINT_TOOL_NAME))
      .sort((left, right) => right.lastHeartbeatAt - left.lastHeartbeatAt)[0];
  }
}
