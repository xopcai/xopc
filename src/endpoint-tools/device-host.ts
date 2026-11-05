import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { EndpointToolRegistry, type EndpointToolApprovalRequest } from '@xopcai/endpoint-tools-client';
import { providerIdentitySchema, providerToolSchema } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

import { connectDeviceBridge } from './bridge-host.js';
import { connectDeviceMcpProvider } from './mcp-provider.js';

const policySchema = providerToolSchema.omit({ name: true, title: true, description: true, inputSchema: true, outputSchema: true });
export const deviceHostConfigSchema = z.strictObject({
  gatewayUrl: z.url(), tokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/), identityPath: z.string().min(1),
  displayName: z.string().min(1).max(80),
  providers: z.array(providerIdentitySchema.omit({ instructions: true, durableOperations: true }).extend({
    server: z.union([
      z.strictObject({ command: z.string().min(1), args: z.array(z.string()).max(100).optional(), env: z.record(z.string(), z.string()).optional(), cwd: z.string().optional() }),
      z.strictObject({ url: z.url(), headers: z.record(z.string(), z.string()).optional() }),
    ]), policies: z.record(z.string(), policySchema), resourcePrefixes: z.array(z.string().min(1).max(2000)).max(20).optional(),
  })).max(20),
}).superRefine((config, context) => {
  const ids = config.providers.map(provider => provider.localId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Duplicate device provider ID' });
});

/** Explicit device-local configuration; never reads Gateway-owned MCP configuration or credentials. */
export async function startDeviceHost(config: z.infer<typeof deviceHostConfigSchema>, options: {
  confirm?: (request: EndpointToolApprovalRequest) => Promise<boolean>;
  onError?: (providerId: string, error: Error) => void;
} = {}) {
  config = deviceHostConfigSchema.parse(config);
  const token = process.env[config.tokenEnv];
  const registry = new EndpointToolRegistry([]);
  const providers: Awaited<ReturnType<typeof connectDeviceMcpProvider>>[] = [];
  let bridge: Awaited<ReturnType<typeof connectDeviceBridge>> | undefined;
  const close = async () => {
    const stopping = bridge?.close();
    await Promise.allSettled(providers.map(provider => provider.close()));
    await stopping;
  };
  try {
    for (const provider of config.providers) providers.push(await connectDeviceMcpProvider({ ...provider, server: provider.server!, registry, durableOperations: 1,
      onError: error => options.onError?.(provider.localId, error) }));
    bridge = await connectDeviceBridge({ ...config, token, registry, confirm: options.confirm });
    return { registry, principalId: bridge.principalId, endpointId: bridge.endpointId, close };
  } catch (error) { await close(); throw error; }
}

export async function readDeviceHostConfig(path: string) {
  const file = resolve(path), bytes = await readFile(file);
  if (bytes.byteLength > 512 * 1024) throw new Error('Device host configuration exceeds its budget');
  return deviceHostConfigSchema.parse(JSON.parse(bytes.toString('utf8')));
}
