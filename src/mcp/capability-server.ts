import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { CapabilityCallSchema, type CapabilityDescriptor } from '@xopcai/gateway-contract';

import { PACKAGE_VERSION } from '../package-version.js';
import { GatewayHttpError, type GatewayHttpClient } from './gateway-http-client.js';

const BASE = '/api/capabilities/operations';

/** An opt-in HTTP proxy, not a new principal or an approval authority. */
export function createCapabilityMcpServer(client: Pick<GatewayHttpClient, 'getJson' | 'postJson'>, capabilityIds: readonly string[]): Server {
  if (!capabilityIds.length || capabilityIds.some(id => !/^xopc\.[a-z0-9_.]+$/.test(id))) {
    throw new Error('At least one explicit xopc capability ID is required (wildcards are not supported)');
  }
  const allowed = new Set(capabilityIds);
  const server = new Server({ name: 'xopc-capabilities', version: PACKAGE_VERSION }, { capabilities: { tools: {} } });
  const catalog = async () => {
    const result = await client.getJson<{ capabilities: CapabilityDescriptor[] }>(BASE);
    return result.capabilities.filter(item => allowed.has(item.id) && item.surfaces.includes('http'));
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: (await catalog()).map((item): Tool => ({
    name: item.id,
    description: `${item.description}\nGateway HTTP proxy. Use the discovered contract unchanged. Writes require a stable idempotencyKey; never retry an uncertain write with a new key.`,
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['majorVersion', 'descriptorDigest', 'input', ...(item.effect === 'read' ? [] : ['idempotencyKey'])],
      properties: {
        majorVersion: { type: 'integer', const: item.majorVersion },
        descriptorDigest: { type: 'string', const: item.descriptorDigest },
        input: item.inputSchema,
        idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 },
      },
    },
    annotations: { readOnlyHint: item.effect === 'read', destructiveHint: item.effect === 'destructive',
      openWorldHint: true },
  })) }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const fail = (code: string, operationId?: string) => ({ isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify({ code, ...(operationId ? { operationId } : {}) }) }] });
    if (!allowed.has(params.name)) return fail('FORBIDDEN');
    const parsed = CapabilityCallSchema.safeParse(params.arguments);
    if (!parsed.success) return fail('INVALID_INPUT');
    let dispatched = false;
    let write = false;
    try {
      // Re-read visibility on every invocation; tool discovery never grants access.
      const descriptor = (await catalog()).find(item => item.id === params.name);
      if (!descriptor) return fail('FORBIDDEN');
      if (parsed.data.majorVersion !== descriptor.majorVersion || parsed.data.descriptorDigest !== descriptor.descriptorDigest) {
        return fail('CONTRACT_CHANGED');
      }
      write = descriptor.effect !== 'read';
      if (write && !parsed.data.idempotencyKey) return fail('INVALID_INPUT');
      dispatched = true;
      const result = await client.postJson<Record<string, unknown>>(`${BASE}/${encodeURIComponent(params.name)}/invocations`, parsed.data);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      if (error instanceof GatewayHttpError) {
        return fail(error.code ?? (error.status === 401 || error.status === 403 ? 'FORBIDDEN'
          : dispatched && write ? 'OUTCOME_UNKNOWN' : 'UNAVAILABLE'), error.operationId);
      }
      return fail(dispatched && write ? 'OUTCOME_UNKNOWN' : 'UNAVAILABLE');
    }
  });
  return server;
}
