import { getProjectForSession } from '../../projects/workspace.js';
import { getSessionMetadata } from '../../storage/sqlite/session-read-repository.js';
import { getSessionInteractionPolicy } from '../session/interaction-policy-state.js';
import { getExternalConversationAgent } from './session-binding.js';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExternalContextAccess } from '../../agent-config/schema.js';
import { loadConfig } from '../../config/loader.js';
import type { Config } from '../../config/schema.js';
import { createMcpConnection, revokeMcpConnection } from '../../mcp/connection-grants.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import { createLogger } from '../../utils/logger.js';
import { loadMergedMcpConfig } from '../mcp/config.js';

const log = createLogger('ExternalMcpBridge');

const GRANT_TTL_MS = 2 * 60 * 60_000;
const GRANT_REFRESH_MARGIN_MS = 15 * 60_000;

const BUILTIN_WORKSPACE_READ_CAPABILITIES = [
  'xopc.workspace.search',
  'xopc.projects.list',
  'xopc.projects.get',
  'xopc.projects.list_milestones',
  'xopc.projects.list_updates',
  'xopc.notes.list',
  'xopc.notes.get',
  'xopc.notes.project_summaries',
  'xopc.tasks.list',
  'xopc.tasks.get',
  'xopc.task_runs.list',
  'xopc.task_runs.get',
  'xopc.files.spaces',
  'xopc.files.list',
  'xopc.files.search',
  'xopc.files.get',
] as const;

const BUILTIN_WORKSPACE_WRITE_CAPABILITIES = [
  'xopc.notes.create',
  'xopc.notes.capture',
  'xopc.notes.append',
  'xopc.notes.update',
  'xopc.tasks.create',
  'xopc.tasks.update',
  'xopc.projects.create_update',
] as const;

export type ExternalMcpServerSpec =
  | {
      name: string;
      transport: 'stdio';
      command: string;
      args: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      name: string;
      transport: 'http' | 'sse';
      url: string;
      headers?: Record<string, string>;
    };

type CachedSessionGrant = {
  fingerprint: string;
  connectionId: string;
  token: string;
  expiresAt: number;
  transcriptId: string;
  agentId: string;
  projectId?: string;
};

const sessionGrants = new Map<string, CachedSessionGrant>();
let activeExternalMcpGatewayPort: number | undefined;

/** Register the live loopback Gateway HTTP port so external runtimes can auto-mount the built-in `xopc` MCP server. */
export function setActiveExternalMcpGatewayPort(port: number | undefined): void {
  activeExternalMcpGatewayPort =
    typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65_535
      ? port
      : undefined;
}

export function getActiveExternalMcpGatewayPort(): number | undefined {
  return activeExternalMcpGatewayPort;
}

/** Revoke any cached ephemeral built-in xopc MCP grant for a conversation. */
export function revokeExternalSessionMcpGrant(conversationId: string): void {
  const existing = sessionGrants.get(conversationId);
  if (!existing) return;
  sessionGrants.delete(conversationId);
  try {
    revokeMcpConnection(existing.connectionId);
  } catch {
    // Best-effort cleanup.
  }
}

/** Revoke all cached ephemeral built-in xopc MCP grants (called on shutdown/cleanup). */
export function revokeAllExternalSessionMcpGrants(): void {
  for (const conversationId of [...sessionGrants.keys()]) {
    revokeExternalSessionMcpGrant(conversationId);
  }
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function resolveXopcCliServeCommand(port: number): { command: string; args: string[] } | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // Built layout: dist/src/agent/external/mcp-bridge.js -> dist/src/cli/bin.js
  const siblingDistBin = resolve(here, '../../cli/bin.js');
  if (existsSync(siblingDistBin)) {
    return {
      command: process.execPath,
      args: [siblingDistBin, 'mcp', 'serve', '--stdio', '--port', String(port)],
    };
  }
  // Dev source layout: src/agent/external/mcp-bridge.ts -> dist/src/cli/bin.js or tsx src/cli/bin.ts
  const repoRoot = resolve(here, '../../..');
  const builtFromRoot = resolve(repoRoot, 'dist/src/cli/bin.js');
  if (existsSync(builtFromRoot)) {
    return {
      command: process.execPath,
      args: [builtFromRoot, 'mcp', 'serve', '--stdio', '--port', String(port)],
    };
  }
  const tsxBin = resolve(repoRoot, process.platform === 'win32' ? 'node_modules/.bin/tsx.cmd' : 'node_modules/.bin/tsx');
  const devBin = resolve(repoRoot, 'src/cli/bin.ts');
  if (existsSync(tsxBin) && existsSync(devBin)) {
    return {
      command: tsxBin,
      args: [devBin, 'mcp', 'serve', '--stdio', '--port', String(port)],
    };
  }
  return null;
}

function resolveBuiltInCapabilityIds(params: {
  contextAccess: 'read_only' | 'read_write';
  conversationId?: string;
  cfg?: Config;
}): string[] {
  const ids = new Set<string>(BUILTIN_WORKSPACE_READ_CAPABILITIES);
  if (params.contextAccess === 'read_write') {
    for (const id of BUILTIN_WORKSPACE_WRITE_CAPABILITIES) ids.add(id);
  }
  const access = resolveUserContextSessionAccess(params.cfg, params.conversationId);
  if (access.userModel) {
    ids.add('xopc.user_context.profile');
  }
  if (access.knowledge) {
    ids.add('xopc.knowledge.list');
    ids.add('xopc.knowledge.search');
  }
  if (access.crossSessionHistory) {
    ids.add('xopc.sessions.list');
    ids.add('xopc.sessions.search');
    ids.add('xopc.sessions.read');
  }
  return [...ids];
}

export function resolveExternalContextAccess(
  conversationId: string,
  configured: ExternalContextAccess | undefined,
): ExternalContextAccess {
  const access = configured ?? 'read_only';
  const policy = getSessionInteractionPolicy(conversationId);
  return access === 'read_write' && (policy.mode === 'plan' || policy.access === 'read-only') ? 'read_only' : access;
}

function grantFingerprint(
  access: 'read_only' | 'read_write',
  projectId: string | undefined,
  capabilities: readonly string[],
): string {
  return JSON.stringify([access, projectId ?? '', [...capabilities].sort()]);
}

/** External credentials are valid only while their issuing Gateway still authorizes the active transcript. */
export function authorizeExternalMcpConnection(connectionId: string, cfg: Config): string | undefined {
  for (const [conversationId, grant] of sessionGrants) {
    if (grant.connectionId !== connectionId) continue;
    const agent = getExternalConversationAgent(conversationId);
    const session = getSessionMetadata(conversationId);
    const projectId = getProjectForSession(conversationId)?.id;
    const contextAccess = resolveExternalContextAccess(conversationId, agent?.execution.contextAccess);
    if (agent?.enabled && !agent.deletedAt && agent.id === grant.agentId
      && session?.transcriptId === grant.transcriptId && projectId === grant.projectId
      && (contextAccess === 'read_only' || contextAccess === 'read_write')
      && grant.fingerprint === grantFingerprint(contextAccess, projectId, resolveBuiltInCapabilityIds({ contextAccess, conversationId, cfg }))) {
      return conversationId;
    }
    revokeExternalSessionMcpGrant(conversationId);
    return undefined;
  }
}

function getOrCreateBuiltInXopcMcpServer(params: {
  conversationId: string;
  agentId?: string;
  projectId?: string;
  contextAccess: 'read_only' | 'read_write';
  gatewayPort: number;
  cfg?: Config;
}): ExternalMcpServerSpec | null {
  const cli = resolveXopcCliServeCommand(params.gatewayPort);
  if (!cli) return null;

  const capabilityIds = resolveBuiltInCapabilityIds({
    contextAccess: params.contextAccess,
    conversationId: params.conversationId,
    cfg: params.cfg,
  });
  const session = getSessionMetadata(params.conversationId);
  if (!session?.transcriptId) return null;
  const fingerprint = grantFingerprint(params.contextAccess, params.projectId, capabilityIds);

  const now = Date.now();
  const cached = sessionGrants.get(params.conversationId);
  let token: string;

  if (cached && cached.transcriptId === session.transcriptId && cached.agentId === session.agentId && cached.fingerprint === fingerprint && cached.expiresAt - now > GRANT_REFRESH_MARGIN_MS) {
    token = cached.token;
  } else {
    if (cached) revokeExternalSessionMcpGrant(params.conversationId);
    const expiresAt = now + GRANT_TTL_MS;
    const created = createMcpConnection(capabilityIds, {
      name: `External runtime (${params.agentId ?? 'agent'})`,
      toolset: params.contextAccess === 'read_write' ? 'external-read-write' : 'external-read-only',
      ...(params.projectId ? { projectIds: [params.projectId] } : {}),
      expiresAt,
    });
    sessionGrants.set(params.conversationId, {
      fingerprint,
      connectionId: created.connectionId,
      token: created.token,
      expiresAt,
      transcriptId: session.transcriptId,
      agentId: session.agentId,
      projectId: params.projectId,
    });
    token = created.token;
  }

  const env: Record<string, string> = {
    XOPC_MCP_TOKEN: token,
  };
  if (process.env.XOPC_CONFIG_PATH?.trim()) env.XOPC_CONFIG_PATH = process.env.XOPC_CONFIG_PATH.trim();
  if (process.env.XOPC_STATE_DIR?.trim()) env.XOPC_STATE_DIR = process.env.XOPC_STATE_DIR.trim();

  return {
    name: 'xopc',
    transport: 'stdio',
    command: cli.command,
    args: cli.args,
    env,
  };
}

/**
 * Resolve enabled third-party MCP servers from xopc config + active agent plugins into a normalized,
 * driver-agnostic list ready for projection into Codex, ACP (AGY), or Claude Code.
 */
export function resolveExternalMcpServers(params: {
  workspaceDir: string;
  agentId?: string;
  cfg?: Config;
}): ExternalMcpServerSpec[] {
  try {
    const cfg = params.cfg ?? loadConfig();
    const merged = loadMergedMcpConfig({
      workspaceDir: params.workspaceDir,
      agentId: params.agentId,
      scope: 'runtime',
      cfg,
    });
    const specs: ExternalMcpServerSpec[] = [];
    for (const [name, raw] of Object.entries(merged.config.mcpServers)) {
      if (!name.trim() || !raw || typeof raw !== 'object') continue;
      const server = raw as Record<string, unknown>;
      if (server.enabled === false) continue;

      const command = typeof server.command === 'string' ? server.command.trim() : '';
      if (command) {
        const args = Array.isArray(server.args)
          ? server.args.filter((item): item is string => typeof item === 'string')
          : [];
        const env = stringMap(server.env);
        const cwd = typeof server.cwd === 'string' && server.cwd.trim() ? server.cwd.trim() : undefined;
        specs.push({
          name,
          transport: 'stdio',
          command,
          args,
          ...(env ? { env } : {}),
          ...(cwd ? { cwd } : {}),
        });
        continue;
      }

      const url = typeof server.url === 'string'
        ? server.url.trim()
        : typeof server.serverUrl === 'string'
          ? server.serverUrl.trim()
          : '';
      if (url) {
        const rawType = typeof server.type === 'string' ? server.type.trim().toLowerCase() : '';
        const transport: 'http' | 'sse' = rawType === 'sse' ? 'sse' : 'http';
        const headers = stringMap(server.headers);
        specs.push({
          name,
          transport,
          url,
          ...(headers ? { headers } : {}),
        });
      }
    }
    return specs;
  } catch (error) {
    log.debug({ err: error, workspaceDir: params.workspaceDir, agentId: params.agentId }, 'Skipped external MCP projection');
    return [];
  }
}

/**
 * Resolve all MCP servers for an external runtime turn: user-configured MCP servers PLUS
 * the scoped built-in `xopc` capability MCP server when `contextAccess` permits it.
 */
export function resolveExternalTurnMcpContext(params: {
  workspaceDir: string;
  agentId?: string;
  conversationId: string;
  projectId?: string;
  contextAccess?: ExternalContextAccess;
  gatewayPort?: number;
  cfg?: Config;
}): { servers: ExternalMcpServerSpec[]; builtInMounted: boolean } {
  const servers = resolveExternalMcpServers({
    workspaceDir: params.workspaceDir,
    agentId: params.agentId,
    cfg: params.cfg,
  });

  const accessTier = resolveExternalContextAccess(params.conversationId, params.contextAccess);
  if ((accessTier !== 'read_only' && accessTier !== 'read_write') || !params.projectId
    || servers.some((spec) => spec.name === 'xopc')) {
    revokeExternalSessionMcpGrant(params.conversationId);
    return { servers, builtInMounted: false };
  }

  const port = params.gatewayPort ?? activeExternalMcpGatewayPort;
  if (!port) {
    return { servers, builtInMounted: false };
  }

  try {
    const cfg = params.cfg ?? loadConfig();
    const builtIn = getOrCreateBuiltInXopcMcpServer({
      conversationId: params.conversationId,
      agentId: params.agentId,
      projectId: params.projectId,
      contextAccess: accessTier,
      gatewayPort: port,
      cfg,
    });
    if (builtIn) {
      return { servers: [...servers, builtIn], builtInMounted: true };
    }
  } catch (error) {
    log.debug(
      { err: error, conversationId: params.conversationId, agentId: params.agentId },
      'Skipped built-in xopc MCP server attachment',
    );
  }
  return { servers, builtInMounted: false };
}

/** Project normalized MCP specs to Codex `thread/start` `config.mcp_servers`. */
export function projectMcpServersForCodex(
  specs: ReadonlyArray<ExternalMcpServerSpec>,
): Record<string, Record<string, unknown>> | undefined {
  if (specs.length === 0) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const spec of specs) {
    if (spec.transport === 'stdio') {
      out[spec.name] = {
        command: spec.command,
        args: spec.args,
        ...(spec.env ? { env: spec.env } : {}),
        ...(spec.cwd ? { cwd: spec.cwd } : {}),
      };
    } else {
      out[spec.name] = {
        url: spec.url,
        ...(spec.headers ? { http_headers: spec.headers } : {}),
      };
    }
  }
  return out;
}

/** Project normalized MCP specs to ACP `session/new` / `session/load` `mcpServers` array. */
export function projectMcpServersForAcp(
  specs: ReadonlyArray<ExternalMcpServerSpec>,
): Array<Record<string, unknown>> {
  return specs.map((spec) => {
    if (spec.transport === 'stdio') {
      return {
        name: spec.name,
        command: spec.command,
        args: spec.args,
        env: Object.entries(spec.env ?? {}).map(([name, value]) => ({ name, value })),
      };
    }
    return {
      type: spec.transport,
      name: spec.name,
      url: spec.url,
      headers: Object.entries(spec.headers ?? {}).map(([name, value]) => ({ name, value })),
    };
  });
}

/** Project normalized MCP specs to Claude Code `control_request: mcp_set_servers` map. */
export function projectMcpServersForClaude(
  specs: ReadonlyArray<ExternalMcpServerSpec>,
): Record<string, Record<string, unknown>> | undefined {
  if (specs.length === 0) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const spec of specs) {
    if (spec.transport === 'stdio') {
      out[spec.name] = {
        type: 'stdio',
        command: spec.command,
        args: spec.args,
        ...(spec.env ? { env: spec.env } : {}),
      };
    } else {
      out[spec.name] = {
        type: spec.transport,
        url: spec.url,
        ...(spec.headers ? { headers: spec.headers } : {}),
      };
    }
  }
  return out;
}
