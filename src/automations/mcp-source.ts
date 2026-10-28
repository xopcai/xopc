import { createHash } from 'node:crypto';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';

import type { Config } from '../config/schema.js';
import { connectorPrincipalForSession } from '../connectors/principal.js';
import { isManagedConnectorServer } from '../connectors/materialize.js';
import { discoverMcpTools, type McpCatalogTool } from '../agent/mcp/tool-catalog.js';
import { mcpConfigRevision } from '../agent/mcp/connection-drafts.js';
import type { NativeMcpConfig } from '../agent/mcp/native-mcp.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { getSessionMetadata } from '../storage/sqlite/session-repository.js';

export const AutomationMcpSourceInput = z.object({ serverId: z.string().min(1).max(64),
  toolNames: z.array(z.string().min(1).max(300)).min(1).max(10),
  toolInputs: z.record(z.string(), z.record(z.string(), z.json())).optional() }).strict();
type Source = { id: string; agentId: string; serverId: string; revision: string; workspaceDir: string;
  tools: Array<{ name: string; digest: string; argumentsHash?: string }>; createdAtMs: number };
const sources = new DurableState<Source>('automation.mcp-source.v1');
type Execution = { source: Source; conversationId: string; readConfig: () => Config; signal: AbortSignal; successful: Set<string>; failed: boolean };
const executions = new Map<string, Execution>();
export class AutomationMcpSourceError extends Error {}
const fail = (message: string): never => { throw new AutomationMcpSourceError(message); };
const serverFor = (config: Config, id: string) => Object.hasOwn(config.mcp?.servers ?? {}, id) ? config.mcp!.servers![id] : undefined;
const toolDigest = (tool: Pick<McpCatalogTool, 'name' | 'inputSchema' | 'annotations'>) => mcpConfigRevision({ name: tool.name, schema: tool.inputSchema, annotations: tool.annotations });

export function getAutomationMcpSource(id: string, agentId: string): Source {
  const source = sources.get(id);
  if (!source || source.agentId !== agentId) return fail('The prepared MCP source is missing or belongs to another assistant. Prepare it again for the selected assistant.');
  return source;
}

export function assertAutomationMcpSource(source: Source, config: Config): void {
  const server = serverFor(config, source.serverId);
  if (!server || server.enabled === false || mcpConfigRevision(server) !== source.revision) {
    fail('The selected MCP source changed, was removed or is disabled. Reconnect and verify that source; no alternative source will be used.');
  }
}

/** Discovery is outside SQLite write transactions; the saved reference contains no credentials. */
export async function prepareAutomationMcpSource(input: unknown, context: { conversationId?: string; agentId?: string;
  canConfigure: boolean; readConfig: () => Config; workspaceDir: string; signal?: AbortSignal }) {
  const args = AutomationMcpSourceInput.parse(input);
  const session = context.conversationId ? getSessionMetadata(context.conversationId) : undefined;
  if (!context.canConfigure || !session || session.agentId !== context.agentId
    || !connectorPrincipalForSession(context.conversationId!).isLocalOwner) return fail('An active owner conversation is required to prepare an automation source.');
  const config = structuredClone(context.readConfig()), server = serverFor(config, args.serverId);
  if (!server?.url || server.enabled === false || isManagedConnectorServer(server) || server.xopcPlugin) {
    return fail('This workflow supports an enabled custom HTTP MCP connection. Managed connectors and account-specific bindings require their own adapter.');
  }
  const catalog = await discoverMcpTools(config, context.workspaceDir, args.serverId, { signal: context.signal });
  const selected = [...new Set(args.toolNames)].sort().map(name => {
    const tool = catalog.find(item => item.name === name);
    if (!tool || tool.exposure === 'hidden' || tool.annotations?.readOnlyHint !== true || tool.annotations.destructiveHint === true) {
      return fail('Select discovered, exposed MCP tools explicitly annotated read-only. No tool permissions will be widened.');
    }
    return { name, digest: toolDigest(tool), argumentsHash: mcpConfigRevision(args.toolInputs?.[name] ?? {}) };
  });
  const fields = { agentId: context.agentId!, serverId: args.serverId, revision: mcpConfigRevision(server), workspaceDir: context.workspaceDir, tools: selected };
  const id = `mcp-source-${createHash('sha256').update(JSON.stringify(fields)).digest('hex')}`;
  const source: Source = { ...fields, id, createdAtMs: Date.now() };
  assertAutomationMcpSource(source, context.readConfig());
  if (!sources.get(id)) sources.set(id, source);
  return { sourceId: id, serverId: source.serverId, agentId: source.agentId, toolNames: selected.map(tool => tool.name),
    fixedInputs: Object.fromEntries(selected.map(tool => [tool.name, args.toolInputs?.[tool.name] ?? {}])),
    verified: false, accountIdentityVerified: false,
    instruction: 'Create a disabled agent automation with action.mcpSourceId set to sourceId. Run an actual trial, inspect its terminal result, then enable the same object only when authorized. This pins the selected server and grant reference, not an independently verified remote account identity. Do not enable explicit-account workflows without their identity adapter.' };
}

/** A run cannot succeed from a model answer alone or silently select a different service. */
export async function withAutomationMcpSource<T>(input: { runId: string; conversationId: string; sourceId: string; agentId: string;
  readConfig: () => Config; signal: AbortSignal }, operation: () => Promise<T>): Promise<T> {
  const source = getAutomationMcpSource(input.sourceId, input.agentId);
  assertAutomationMcpSource(source, input.readConfig());
  const catalog = await discoverMcpTools(input.readConfig(), source.workspaceDir, source.serverId, { signal: input.signal });
  assertAutomationMcpSource(source, input.readConfig());
  if (source.tools.some(expected => !catalog.some(tool => tool.name === expected.name && tool.exposure !== 'hidden'
    && toolDigest(tool) === expected.digest))) return fail('The selected MCP tool contract changed. Verify a new source before running again.');
  if (executions.has(input.runId)) return fail('This source-bound run is already executing.');
  const execution: Execution = { source, conversationId: input.conversationId, readConfig: input.readConfig, signal: input.signal, successful: new Set(), failed: false };
  executions.set(input.runId, execution);
  try {
    const result = await operation();
    input.signal.throwIfAborted();
    assertAutomationMcpSource(source, input.readConfig());
    if (execution.failed || source.tools.some(tool => !execution.successful.has(tool.name))) {
      return fail('The selected MCP read did not complete successfully in this run. An assistant answer is not verified source data.');
    }
    return result;
  } finally { executions.delete(input.runId); }
}

export function boundAutomationMcpSource(runId: string, conversationId: string): Source | undefined {
  const execution = executions.get(runId);
  if (execution && execution.conversationId !== conversationId) return fail('The MCP source belongs to a different execution conversation.');
  return execution?.source;
}

export function restrictAutomationMcpConfig(runId: string, conversationId: string, loaded: NativeMcpConfig): NativeMcpConfig {
  const source = boundAutomationMcpSource(runId, conversationId);
  if (!source) return loaded;
  const entry = loaded.servers.find(server => server.name === source.serverId && server.config.enabled !== false);
  if (!entry) return fail('The selected MCP source is not available to this execution.');
  return { ...loaded, errors: [], automationSourceRunId: runId, servers: [{ ...entry, config: { ...entry.config,
    exposure: entry.config.exposure === 'hidden' ? 'hidden' : 'deferred' } }] };
}

/** Native pi still executes tools. The guard pins the current contract at each actual call. */
export function createAutomationMcpSourceGuard(runId: string): ExtensionFactory {
  return pi => {
    pi.on('tool_call', event => {
      const execution = executions.get(runId);
      if (!execution || execution.signal.aborted) return { block: true, reason: 'The bound automation execution ended.' };
      try {
        assertAutomationMcpSource(execution.source, execution.readConfig());
        if (event.toolName === 'tool_search') return;
        const expected = execution.source.tools.find(tool => tool.name === event.toolName);
        const actual = pi.getAllTools().find(tool => tool.name === event.toolName);
        if (!expected || !actual || actual.exposure === 'hidden'
          || toolDigest({ name: actual.name, inputSchema: actual.parameters, annotations: actual.annotations }) !== expected.digest
          || mcpConfigRevision(event.input ?? {}) !== (expected.argumentsHash ?? mcpConfigRevision({}))) {
          execution.failed = true; return { block: true, reason: 'This tool is outside the pinned MCP read contract.' };
        }
      } catch { execution.failed = true; return { block: true, reason: 'The selected MCP source changed. No alternative source is allowed.' }; }
    });
    pi.on('tool_result', event => {
      const execution = executions.get(runId);
      if (!execution || !execution.source.tools.some(tool => tool.name === event.toolName)) return;
      if (event.isError) execution.failed = true;
      else execution.successful.add(event.toolName);
    });
  };
}
