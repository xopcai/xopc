import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema, ElicitRequestSchema, ElicitResultSchema, type ElicitRequest, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { EndpointToolClientError, type EndpointToolRegistry, type CapabilityProviderDefinition, type EndpointToolExecutionContext } from '@xopcai/endpoint-tools-client';
import { providerToolSchema, type ProviderTool, type EndpointToolContent } from '@xopcai/endpoint-tools-protocol';

export function resourceWithinScope(uri: string, prefix: string): boolean {
  try {
    const resource = new URL(uri), scope = new URL(prefix);
    if (resource.username || resource.password || resource.hash || scope.search || scope.hash) return false;
    const path = decodeURIComponent(resource.pathname), root = decodeURIComponent(scope.pathname).replace(/\/$/, '');
    if (path.includes('\\') || path.split('/').some(part => part === '..' || part === '.')) return false;
    return resource.protocol === scope.protocol && resource.host === scope.host
      && (path === root || path.startsWith(root + '/'));
  } catch { return false; }
}

type ToolPolicy = Omit<ProviderTool, 'name' | 'title' | 'description' | 'inputSchema' | 'outputSchema'>;
export interface DeviceMcpProviderOptions {
  registry: EndpointToolRegistry;
  localId: string;
  title: string;
  summary: string;
  server: { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
    | { url: string; headers?: Record<string, string> };
  policies: Record<string, ToolPolicy>;
  resourcePrefixes?: string[];
  durableOperations?: 1;
  gatewayFormInput?: 1;
  onElicitation?: (request: ElicitRequest['params'], context: EndpointToolExecutionContext) => Promise<ElicitResult>;
  onError?: (error: Error) => void;
}

/** Runs on a device host. Gateway MCP configuration, credentials and runtime are never imported. */
export async function connectDeviceMcpProvider(options: DeviceMcpProviderOptions) {
  const client = new Client({ name: 'xopc-device-host', version: '1' }, {
    capabilities: options.onElicitation || options.gatewayFormInput ? { elicitation: { form: {} } } : {},
  });
  let closed = false, requested = false, refreshPending: Promise<void> | undefined;
  let active: EndpointToolExecutionContext | undefined;
  const fail = (error: unknown) => {
    options.registry.removeProvider(options.localId);
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  };
  client.onclose = () => { closed = true; options.registry.removeProvider(options.localId); };
  if (options.onElicitation || options.gatewayFormInput) client.setRequestHandler(ElicitRequestSchema, async request => {
    const context = active;
    if (!context || context.signal.aborted || request.params.mode === 'url') return { action: 'decline' };
    const result = options.onElicitation ? await options.onElicitation(request.params, context)
      : context.requestInput ? ElicitResultSchema.parse(await context.requestInput(request.params.message, request.params.requestedSchema))
        : { action: 'decline' as const };
    return active === context && !context.signal.aborted ? result : { action: 'cancel' };
  });

  const content = async (result: { content?: Array<Record<string, unknown>>; structuredContent?: unknown; isError?: boolean }, context: EndpointToolExecutionContext): Promise<EndpointToolContent[]> => {
    if (result.isError) throw new EndpointToolClientError('TOOL_EXECUTION_FAILED', 'The MCP provider reported an execution error');
    if (result.structuredContent !== undefined) return [{ type: 'json', value: result.structuredContent }];
    const blocks: EndpointToolContent[] = [];
    for (const block of result.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') blocks.push({ type: 'text', text: block.text });
      else if (block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string') {
        if (block.data.length > 32 * 1024 * 1024) throw new Error('MCP image exceeds its byte budget');
        blocks.push(await context.uploadFile({ name: 'mcp-image', mimeType: block.mimeType, bytes: Buffer.from(block.data, 'base64') }));
      } else if (block.type === 'resource_link' && typeof block.uri === 'string') {
        blocks.push({ type: 'json', value: { providerId: options.localId, resourceUri: block.uri, name: block.name } });
      } else if (block.type === 'resource' && block.resource && typeof block.resource === 'object') {
        const resource = block.resource as { uri?: string; text?: string; blob?: string; mimeType?: string };
        if (typeof resource.text === 'string') blocks.push({ type: 'text', text: resource.text });
        else if (typeof resource.blob === 'string') {
          if (resource.blob.length > 32 * 1024 * 1024) throw new Error('MCP resource exceeds its byte budget');
          blocks.push(await context.uploadFile({ name: 'mcp-resource',
            mimeType: resource.mimeType ?? 'application/octet-stream', bytes: Buffer.from(resource.blob, 'base64') }));
        }
        else throw new Error('Unsupported MCP resource content');
      } else throw new Error('Unsupported MCP content type');
    }
    return blocks.length ? blocks : [{ type: 'text', text: 'Completed without content' }];
  };

  const execute = async (context: EndpointToolExecutionContext, operation: () => Promise<EndpointToolContent[]>) => {
    if (closed) throw new Error('MCP provider is disconnected');
    // Serial admission keeps reverse requests attributable to exactly one invocation.
    if (active) throw new EndpointToolClientError('TOOL_BUSY', 'MCP provider already has an active invocation');
    active = context;
    try { context.signal.throwIfAborted(); return { content: await operation() }; }
    finally { active = undefined; }
  };

  const refresh = (): Promise<void> => {
    requested = true;
    if (refreshPending) return refreshPending;
    refreshPending = (async () => {
      do {
        requested = false;
        const discovered: Awaited<ReturnType<typeof client.listTools>>['tools'] = [];
        let cursor: string | undefined;
        const seen = new Set<string>();
        let pages = 0;
        if (client.getServerCapabilities()?.tools) do {
          if (++pages > 100 || cursor && seen.has(cursor)) throw new Error('MCP pagination exceeds its budget');
          if (cursor) seen.add(cursor);
          const page = await client.listTools(cursor ? { cursor } : undefined);
          discovered.push(...page.tools);
          if (discovered.length > 100) throw new Error('MCP tool catalog exceeds its budget');
          cursor = page.nextCursor;
        } while (cursor);
        const tools: CapabilityProviderDefinition['tools'] = discovered.flatMap(tool => {
          const policy = options.policies[tool.name];
          if (!policy) return [];
          const descriptor = providerToolSchema.parse({ ...policy, name: tool.name, title: tool.title ?? tool.name,
            description: tool.description ?? tool.name, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, maxConcurrency: 1 });
          return [{ descriptor, execute: (args, context) => execute(context, async () => {
            let toolArguments = args;
            if (descriptor.artifactInput) {
              if (!context.readArtifact) throw new Error('An authorized artifact is required');
              const bytes = await context.readArtifact();
              try { toolArguments = { ...args, [descriptor.artifactInput]: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') }; }
              finally { bytes.fill(0); }
            }
            const result = await client.callTool({ name: tool.name, arguments: toolArguments }, undefined, { signal: context.signal,
              timeout: descriptor.timeoutMs, onprogress: progress => context.reportProgress({
                ...(progress.message ? { message: progress.message } : {}),
                ...(progress.total && progress.total > 0 ? { percent: Math.min(100, 100 * progress.progress / progress.total) } : {}),
              }) });
            return content(result as Parameters<typeof content>[0], context);
          }) }];
        });
        const resourcePolicy = options.policies.xopc_resource_read;
        if (resourcePolicy && options.resourcePrefixes?.length && client.getServerCapabilities()?.resources) {
          if (tools.some(tool => tool.descriptor.name === 'xopc_resource_read')) throw new Error('MCP resource helper name conflicts with a tool');
          tools.push({ descriptor: providerToolSchema.parse({ ...resourcePolicy, name: 'xopc_resource_read', title: 'Read provider resource',
            description: 'Read a resource URI from this provider within the configured resource scope.',
            inputSchema: { type: 'object', properties: { uri: { type: 'string', maxLength: 2000 } }, required: ['uri'], additionalProperties: false }, maxConcurrency: 1 }),
          execute: (args, context) => execute(context, async () => {
            const uri = String(args.uri ?? '');
            if (!options.resourcePrefixes!.some(prefix => resourceWithinScope(uri, prefix))) throw new EndpointToolClientError('PERMISSION_DENIED', 'Resource is outside the installed scope');
            const result = await client.readResource({ uri }, { signal: context.signal, timeout: resourcePolicy.timeoutMs });
            return content({ content: result.contents.map(resource => ({ type: 'resource', resource })) }, context);
          }) });
        }
        if (closed) return;
        options.registry.registerProvider({ localId: options.localId, title: options.title, summary: options.summary,
          instructions: client.getInstructions()?.slice(0, 8_000), durableOperations: options.durableOperations,
          gatewayFormInput: options.gatewayFormInput, tools });
      } while (requested && !closed);
    })().catch(error => { fail(error); throw error; }).finally(() => { refreshPending = undefined; });
    return refreshPending;
  };
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => { void refresh().catch(() => {}); });
  let transport: StdioClientTransport | StreamableHTTPClientTransport;
  if ('command' in options.server) transport = new StdioClientTransport({ ...options.server, stderr: 'ignore' });
  else {
    const url = new URL(options.server.url);
    if (url.username || url.password || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
      throw new Error('MCP HTTP providers require HTTPS or a loopback origin');
    }
    transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: options.server.headers, redirect: 'error' },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 } });
  }
  // A late RPC reply after cancellation is a protocol diagnostic, not a transport failure.
  transport.onerror = error => fail(error);
  try { await client.connect(transport); await refresh(); }
  catch (error) { await client.close(); throw error; }
  return { refresh, async close() { closed = true; options.registry.removeProvider(options.localId); await client.close(); } };
}
