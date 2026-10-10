import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';

import type { Config } from '../../config/schema.js';
import { getOrCreateSessionMcpRuntime } from '../mcp/bundle-mcp-runtime.js';
import { externalToolRef } from '../external-tools/refs.js';
import type { VersionedExternalToolDescriptor } from '../external-tools/types.js';
import { setXopcToolMetadata } from './tool-metadata.js';
import { abortEmbeddedRun } from './runs.js';
import { evictEmbeddedSessionRunner } from './session-runner.js';
import { runWithEmbeddedExecutionSession } from './execution-context.js';

const watchedRuntimes = new WeakSet<object>();

/** Load one opted-in server through the same contracts and executor as xopc_tool_execute. */
export async function materializeDeferredMcpTools(params: {
  conversationId: string; workspaceDir: string; config?: Config; server: string; tools: readonly AgentTool[];
}): Promise<AgentTool[]> {
  const describe = params.tools.find(tool => tool.name === 'xopc_tool_describe');
  const execute = params.tools.find(tool => tool.name === 'xopc_tool_execute');
  if (!describe || !execute) return [];
  const runtime = await getOrCreateSessionMcpRuntime({ sessionId: params.conversationId,
    conversationId: params.conversationId, workspaceDir: params.workspaceDir, cfg: params.config });
  const release = runtime.acquireLease?.();
  if (!watchedRuntimes.has(runtime)) {
    watchedRuntimes.add(runtime);
    runtime.onCatalogInvalidated?.(() => {
      void abortEmbeddedRun(params.conversationId);
      evictEmbeddedSessionRunner(params.conversationId, 'mcp_catalog_changed');
    });
  }
  try {
    const catalog = await runtime.getCatalog();
    const candidates = catalog.tools.filter(tool => tool.serverName === params.server);
    const names = new Set(params.tools.map(tool => tool.name));
    const tools: AgentTool[] = [];
    for (const candidate of candidates) {
      const ref = externalToolRef('mcp', candidate.safeServerName, candidate.toolName);
      const result = await runWithEmbeddedExecutionSession(params.conversationId,
        () => describe.execute('mcp-discovery', { toolRefs: [ref] }));
      const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      const descriptor = (JSON.parse(text) as { tools: VersionedExternalToolDescriptor[] }).tools.find(tool => tool.toolRef === ref);
      if (!descriptor) continue;
      const name = `mcp__${candidate.safeServerName}__${candidate.toolName}`.replace(/[^A-Za-z0-9_]/g, '_');
      if (name.length > 64) throw new Error(`MCP tool identifier exceeds 64 characters: ${name}`);
      if (names.has(name)) throw new Error(`MCP tool identifier collision: ${name}`);
      names.add(name);
      tools.push(setXopcToolMetadata({
        name, label: descriptor.title, description: descriptor.description,
        parameters: descriptor.inputSchema as TSchema,
        execute(id, args, signal, update) {
          return runWithEmbeddedExecutionSession(params.conversationId,
            () => execute.execute(id, { toolRef: ref, revision: descriptor.revision, arguments: args,
              ...(descriptor.batchRead ? { readOnly: true } : {}) }, signal, update));
        },
      }, { exposure: 'deferred', namespace: { name: `mcp__${candidate.safeServerName}`, description: `MCP server ${params.server}`,
          instructions: catalog.servers[params.server]?.instructions },
        annotations: descriptor.annotations, outputSchema: descriptor.outputSchema as TSchema | undefined,
        external: { toolRef: ref, revision: descriptor.revision, readOnly: descriptor.batchRead === true } }));
    }
    return tools;
  } finally { release?.(); }
}
