import { createHash, randomUUID } from 'node:crypto';

import { McpServerSchema, type Config, type McpServerConfig } from '../../config/schema.js';
import { getWorkspacePath } from '../../config/workspace-path-helpers.js';
import { isManagedConnectorServer } from '../../connectors/materialize.js';
import { loadMergedMcpConfig } from './config.js';
import { createNativeMcpCredentials, type NativeMcpCredentials } from './credential-store.js';
import { cancelMcpAuthorization, getMcpAuthorization, probeMcpConnection, startMcpAuthorization, submitMcpRedirect,
  type McpConnectionProbe } from './connection-setup.js';
import { discoverMcpTools } from './tool-catalog.js';

const TTL_MS = 10 * 60_000;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
export function mcpConfigRevision(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'null').digest('hex');
}
export class McpDraftError extends Error {
  constructor(public readonly status: 400 | 404 | 409 | 429 | 500, message: string) { super(message); }
}
type Draft = {
  id: string; owner: string; serverId: string; sourceServerId?: string; revision: string; workspace: string;
  server: McpServerConfig; config: Config; credentials: NativeMcpCredentials; controller: AbortController;
  expiresAt: number; timer: ReturnType<typeof setTimeout>; probe?: McpConnectionProbe; authorizationId?: string;
  running: boolean; committing: boolean; checkedAt?: string;
  toolsPending?: ReturnType<typeof discoverMcpTools>;
};
export type McpDraftInput = { serverId: string; sourceServerId?: string; expectedServer?: unknown; server: unknown };

/** Unsaved configuration and OAuth state belong to one principal and never enter the live registry. */
export class McpConnectionDrafts {
  private readonly completed = new Map<string, { owner: string; enable: boolean; serverId: string; reloadRequired?: boolean; timer: ReturnType<typeof setTimeout> }>();
  private readonly drafts = new Map<string, Draft>();
  constructor(private readonly options: {
    readConfig: () => Config;
    saveConfig: (config: Config, expectedConfig?: Config) => Promise<{ saved: boolean; error?: string; persisted?: boolean; conflict?: boolean }>;
  }) {}

  async create(owner: string, input: McpDraftInput) {
    const current = this.options.readConfig();
    if (!/^[a-zA-Z0-9_-]+$/.test(input.serverId) || input.sourceServerId && input.sourceServerId !== input.serverId) throw new McpDraftError(400, 'Invalid or changed MCP server ID.');
    const source = Object.hasOwn(current.mcp?.servers ?? {}, input.serverId) ? current.mcp?.servers?.[input.serverId] : undefined;
    if (input.sourceServerId && (!source || isManagedConnectorServer(source))) throw new McpDraftError(409, 'The original custom server no longer exists.');
    if (input.sourceServerId && mcpConfigRevision(source) !== mcpConfigRevision(input.expectedServer)) throw new McpDraftError(409, 'The original configuration changed. Reload before testing.');
    this.assertAvailable(current, input.serverId, input.sourceServerId);
    const parsed = McpServerSchema.safeParse(input.server);
    if (!parsed.success) throw new McpDraftError(400, 'Invalid MCP configuration.');
    const revision = mcpConfigRevision(source);
    const server = structuredClone(parsed.data);
    for (const internal of ['xopcConnector', 'xopcPlugin', 'xopcOAuthCredentialId', 'xopcConnectionCheck']) delete server[internal];
    const workspace = getWorkspacePath(current) || process.cwd();
    const config = structuredClone(current);
    config.mcp = { servers: { [input.serverId]: { ...server, enabled: true } } };
    const credentials = await createNativeMcpCredentials(true);
    if (this.drafts.size >= 100 || [...this.drafts.values()].filter(draft => draft.owner === owner).length >= 8) throw new McpDraftError(429, 'Too many unsaved MCP connection tests.');
    const id = randomUUID();
    const timer = setTimeout(() => {
      const draft = this.drafts.get(id);
      if (draft && !draft.committing) this.dispose(draft);
    }, TTL_MS);
    timer.unref();
    const draft: Draft = { id, owner, serverId: input.serverId, sourceServerId: input.sourceServerId,
      revision, workspace, server, config, credentials, controller: new AbortController(),
      timer, expiresAt: Date.now() + TTL_MS, running: false, committing: false };
    this.drafts.set(id, draft);
    return { id, serverId: draft.serverId, expiresAt: draft.expiresAt };
  }

  async probe(owner: string, id: string): Promise<McpConnectionProbe> {
    const draft = this.get(owner, id); this.assertIdle(draft); draft.authorizationId = undefined; draft.running = true; draft.probe = undefined; draft.checkedAt = undefined;
    try {
      const result = await probeMcpConnection(draft.config, draft.workspace, draft.serverId, { credentials: draft.credentials, signal: draft.controller.signal });
      this.get(owner, id);
      draft.probe = result; if (result.state === 'connected') draft.checkedAt = new Date().toISOString(); return result;
    } finally { draft.running = false; }
  }
  authorize(owner: string, id: string) {
    const draft = this.get(owner, id); this.assertIdle(draft);
    if (draft.authorizationId) cancelMcpAuthorization(draft.authorizationId, owner);
    draft.probe = undefined;
    const attempt = startMcpAuthorization(draft.config, draft.workspace, draft.serverId, owner, { credentials: draft.credentials, authorizationScope: draft.id });
    draft.authorizationId = attempt.id;
    return attempt;
  }
  authorization(owner: string, id: string) {
    const draft = this.get(owner, id);
    const result = draft.authorizationId && getMcpAuthorization(draft.authorizationId, owner, draft.config);
    if (!result) throw new McpDraftError(404, 'Draft authorization not found.');
    if (result.state === 'connected' && draft.probe?.state !== 'connected') {
      draft.probe = { state: 'connected', toolCount: result.toolCount }; draft.checkedAt = new Date().toISOString();
    }
    return result;
  }
  redirect(owner: string, id: string, url: string) {
    const draft = this.get(owner, id);
    if (!draft.authorizationId || !submitMcpRedirect(draft.authorizationId, owner, url, draft.config)) throw new McpDraftError(400, 'The callback address does not match this draft authorization.');
  }
  cancelAuthorization(owner: string, id: string) {
    const draft = this.get(owner, id);
    if (draft.committing) throw new McpDraftError(409, 'This draft is being saved.');
    if (draft.running) throw new McpDraftError(409, 'A connection test is still running.');
    if (draft.authorizationId) cancelMcpAuthorization(draft.authorizationId, owner);
    draft.authorizationId = undefined; draft.probe = undefined;
  }
  async tools(owner: string, id: string) {
    const draft = this.get(owner, id);
    if (draft.toolsPending) return draft.toolsPending;
    this.assertIdle(draft);
    if (draft.probe?.state !== 'connected') throw new McpDraftError(409, 'Test the connection first.');
    draft.running = true;
    draft.toolsPending = (async () => {
      try {
        const tools = await discoverMcpTools(draft.config, draft.workspace, draft.serverId, { credentials: draft.credentials, signal: draft.controller.signal });
        this.get(owner, id); return tools;
      } finally { draft.running = false; draft.toolsPending = undefined; }
    })();
    return draft.toolsPending;
  }

  /** Caller serializes this with other Gateway config writes. Only this entry is merged into the latest config. */
  async commit(owner: string, id: string, enable = false) {
    const completed = this.completed.get(id);
    if (completed?.owner === owner) {
      if (completed.enable !== enable) throw new McpDraftError(409, 'This test has already been committed with different settings.');
      return { serverId: completed.serverId, ...(completed.reloadRequired ? { reloadRequired: true } : {}) };
    }
    const draft = this.get(owner, id); this.assertIdle(draft);
    if (draft.authorizationId) this.authorization(owner, id);
    if (draft.probe?.state !== 'connected') throw new McpDraftError(409, 'A successful connection test is required before saving.');
    const current = this.options.readConfig();
    if (mcpConfigRevision(current.mcp?.servers?.[draft.serverId]) !== draft.revision || (getWorkspacePath(current) || process.cwd()) !== draft.workspace) throw new McpDraftError(409, 'Configuration changed after the test. Reload and test again.');
    this.assertAvailable(current, draft.serverId, draft.sourceServerId);
    draft.committing = true;
    let alias: string | undefined;
    let durable: NativeMcpCredentials | undefined;
    let published = false;
    try {
      const server = structuredClone(draft.server);
      if (enable) server.enabled = true;
      if (typeof server.url === 'string') {
        const state = await draft.credentials.forServer(draft.serverId, server.url).load();
        // An empty native state is intentional: without it pi could adopt historical
        // credentials by server name or the legacy URL key after a public/static-auth test.
        const candidateAlias = `mcp_draft_${randomUUID().replaceAll('-', '')}`;
        durable = await createNativeMcpCredentials();
        await durable.forServer(candidateAlias, server.url).save(state?.tokens
          ? { ...state, codeVerifier: undefined, oauthState: undefined }
          : { serverUrl: server.url });
        alias = candidateAlias;
        server.xopcOAuthCredentialId = alias;
      }
      server.xopcConnectionCheck = { checkedAt: draft.checkedAt, toolCount: draft.probe.toolCount ?? 0,
        revision: mcpConfigRevision(server) };
      const latest = this.options.readConfig();
      if (mcpConfigRevision(latest.mcp?.servers?.[draft.serverId]) !== draft.revision || (getWorkspacePath(latest) || process.cwd()) !== draft.workspace) throw new McpDraftError(409, 'Configuration changed while preparing the save. Test again.');
      this.assertAvailable(latest, draft.serverId, draft.sourceServerId);
      const next = structuredClone(latest);
      next.mcp = { ...next.mcp, servers: { ...next.mcp?.servers, [draft.serverId]: server } };
      const result = await this.options.saveConfig(next, structuredClone(latest));
      // Some persistence implementations can report a post-write reload error. Do not delete credentials now in use.
      published = result.persisted === true || alias !== undefined && this.options.readConfig().mcp?.servers?.[draft.serverId]?.xopcOAuthCredentialId === alias;
      if (result.conflict) throw new McpDraftError(409, 'Configuration changed before writing. Reload and test again.');
      if (!result.saved && !result.persisted) throw new McpDraftError(500, 'Could not save MCP configuration. Retry or reload the current configuration.');
      const reloadRequired = !result.saved;
      published = true;
      const timer = setTimeout(() => this.completed.delete(id), TTL_MS); timer.unref();
      this.completed.set(id, { owner, enable, serverId: draft.serverId, reloadRequired, timer });
      this.dispose(draft);
      return { serverId: draft.serverId, ...(reloadRequired ? { reloadRequired: true } : {}) };
    } finally {
      draft.committing = false;
      if (alias && this.options.readConfig().mcp?.servers?.[draft.serverId]?.xopcOAuthCredentialId === alias) published = true;
      if (!published && alias && durable && typeof draft.server.url === 'string') durable.remove(alias, draft.server.url);
      if (this.drafts.has(id) && draft.expiresAt <= Date.now()) this.dispose(draft);
    }
  }

  remove(owner: string, id: string): void {
    const draft = this.drafts.get(id);
    if (!draft || draft.owner !== owner) return;
    if (draft.committing) throw new McpDraftError(409, 'This draft is being saved.');
    this.dispose(draft);
  }
  close(): void {
    for (const draft of this.drafts.values()) this.dispose(draft);
    for (const item of this.completed.values()) clearTimeout(item.timer); this.completed.clear();
  }
  private get(owner: string, id: string): Draft {
    const draft = this.drafts.get(id);
    if (!draft || draft.owner !== owner) throw new McpDraftError(404, 'MCP draft not found or expired.');
    if (draft.expiresAt <= Date.now() && !draft.committing) { this.dispose(draft); throw new McpDraftError(404, 'MCP draft expired.'); }
    return draft;
  }
  private assertIdle(draft: Draft): void {
    const auth = draft.authorizationId && getMcpAuthorization(draft.authorizationId, draft.owner, draft.config);
    if (draft.running || draft.committing || auth && (auth.state === 'starting' || auth.state === 'authorizing')) throw new McpDraftError(409, 'Another draft operation is still running.');
  }
  private assertAvailable(config: Config, id: string, sourceId?: string): void {
    const all = loadMergedMcpConfig({ cfg: config, workspaceDir: getWorkspacePath(config) || process.cwd() }).config.mcpServers;
    if (Object.keys(all).some(other => other !== sourceId && other.replaceAll('-', '_') === id.replaceAll('-', '_'))) throw new McpDraftError(409, 'The MCP server ID is already in use.');
  }
  private dispose(draft: Draft): void {
    this.drafts.delete(draft.id); clearTimeout(draft.timer); draft.controller.abort();
    if (draft.authorizationId) cancelMcpAuthorization(draft.authorizationId, draft.owner);
  }
}
