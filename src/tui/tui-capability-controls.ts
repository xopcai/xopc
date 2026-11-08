import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import type { McpAuthorization } from '../agent/mcp/connection-setup.js';
import type { PluginSetupJob } from '../extensions/agent-plugins/setup.js';
import type { TuiBackend } from './tui-backend.js';
import type { TuiManagementCommand } from './tui-management.js';

export function createCapabilityControls(context: {
  client: TuiBackend; conversationId: () => string; sessionVersion: () => number;
  choose: (title: string, choices: string[]) => Promise<string | undefined>;
  input: (title: string) => Promise<string | undefined>;
  show: (title: string, content: string) => void;
}) {
  return async (kind: 'mcp' | 'plugins', args: string) => {
    const conversationId = context.conversationId(), version = context.sessionVersion();
    const current = () => version === context.sessionVersion();
    const run = (command: TuiManagementCommand) => context.client.manageCapability(conversationId, command);
    const view = (title: string, data: unknown) => { if (current()) context.show(title, typeof data === 'string' ? data : JSON.stringify(data, null, 2)); };
    const confirm = async (title: string) => current() && await context.choose(title, ['Cancel', 'Confirm']) === 'Confirm' && current();
    const auth = async (initial: McpAuthorization) => {
      let attempt: McpAuthorization | null = initial;
      try {
        while (current() && attempt && ['starting', 'authorizing'].includes(attempt.state)) {
          const choice = await context.choose(`MCP sign-in [${attempt.state}]${attempt.authorizationUrl ? `\nOpen in your browser:\n${attempt.authorizationUrl}` : ''}`,
            ['Refresh status', ...(attempt.acceptsRedirect ? ['Paste callback URL'] : []), 'Cancel sign-in']);
          if (!choice || choice === 'Cancel sign-in' || !current()) { await run({ action: 'mcp.cancel', id: initial.id }); return; }
          if (choice === 'Paste callback URL') {
            const url = await context.input('Paste the callback URL from your browser');
            if (url && current()) await run({ action: 'mcp.redirect', id: initial.id, url });
          }
          attempt = await run({ action: 'mcp.auth', id: initial.id }) as McpAuthorization | null;
        }
        view('MCP sign-in', attempt);
      } finally {
        if (!current()) await run({ action: 'mcp.cancel', id: initial.id });
      }
    };
    let [action, ...remaining] = args.trim().split(/\s+/);
    let id = remaining.join(' ');
    if (!args.trim()) {
      const items = await context.client.listCapabilities(conversationId, kind);
      if (!current()) return;
      if (!items.length && kind === 'mcp') { view('MCP connections', 'No configured MCP servers.'); return; }
      const choices = items.map(item => `${item.id} [${item.state}] ${item.description}`);
      const choice = await context.choose(kind === 'mcp' ? 'MCP connections' : 'Plugins', [...choices, ...(kind === 'plugins' ? ['Browse marketplace', 'Install from source'] : [])]);
      if (!choice || !current()) return;
      if (choice === 'Browse marketplace') {
        const query = await context.input('Search plugin marketplace (empty lists all)');
        if (!current()) return;
        const catalog = await run({ action: 'plugin.catalog', query: query ?? '' }) as Array<{ id: string; name: string; description?: string }>;
        const labels = catalog.map(plugin => `${plugin.name} · ${plugin.description ?? ''}`);
        const selected = await context.choose('Plugin marketplace', labels);
        const plugin = catalog[labels.indexOf(selected ?? '')];
        if (!plugin || !current()) return; action = 'install'; id = `store:${plugin.id}`;
      }
      else if (choice === 'Install from source') { action = 'install'; id = await context.input('Plugin directory, Git URL or marketplace source') ?? ''; }
      else {
        id = items[choices.indexOf(choice)]!.id;
        action = await context.choose(id, kind === 'mcp' ? ['probe', 'tools', 'login', 'logout'] : ['details', 'setup', 'enable', 'disable', 'update', 'rollback', 'remove']) ?? '';
      }
    }
    if (!action || !id || !current()) return;
    if (kind === 'mcp') {
      if (action === 'probe' || action === 'tools') view(`MCP ${action}: ${id}`, await run({ action: `mcp.${action}`, id }));
      else if (action === 'login') await auth(await run({ action: 'mcp.login', id }) as McpAuthorization);
      else if (action === 'logout') { if (await confirm(`Remove the saved MCP authorization for ${id}?`)) await run({ action: 'mcp.logout', id }); }
      else throw new Error('Usage: /mcp [probe|tools|login|logout] <server-id>');
      return;
    }
    id = id.replace(/^plugin:/, '');
    if (action === 'install' || action === 'update') {
      const source = action === 'install' ? remaining.length ? remaining.join(' ') : id : await context.input(`Update ${id}: plugin source`);
      if (!source || !current()) return;
      const inspection = await run({ action: 'plugin.inspect', source }) as { reviewHash: string; capabilities: unknown; addedCapabilities: unknown; diagnostics: unknown; manifest: { name: string; version?: string } };
      if (!await confirm(`Install ${inspection.manifest.name} ${inspection.manifest.version ?? ''}?\nCapabilities:\n${JSON.stringify(inspection.capabilities)}\nAdded:\n${JSON.stringify(inspection.addedCapabilities)}\nDiagnostics:\n${JSON.stringify(inspection.diagnostics)}`)) return;
      view('Plugin installation', await run({ action: 'plugin.install', source, reviewHash: inspection.reviewHash, ...(action === 'update' ? { replaceId: id } : {}) }));
      return;
    }
    if (action === 'details') { view(id, await run({ action: 'plugin.get', id })); return; }
    if (action === 'enable' || action === 'disable') { if (await confirm(`${action} plugin ${id}?`)) view(id, await run({ action: 'plugin.enable', id, enabled: action === 'enable' })); return; }
    if (action === 'rollback') { if (await confirm(`Roll back plugin ${id} to its previous version?`)) view(id, await run({ action: 'plugin.rollback', id })); return; }
    if (action === 'remove') { if (await confirm(`Remove plugin ${id}? Installed data and credentials are retained.`)) await run({ action: 'plugin.remove', id, credentials: false }); return; }
    if (action !== 'setup') throw new Error('Usage: /plugins [details|setup|enable|disable|update|rollback|remove] <id>, or /plugins install <source>');
    let job = await run({ action: 'plugin.setup.get', id }) as PluginSetupJob | null;
    if (!job) job = await run({ action: 'plugin.setup', id }) as PluginSetupJob;
    while (current() && job && job.state !== 'completed') {
      const choice = await context.choose(`Plugin ${id} [${job.state}]\n${JSON.stringify(job.connections)}\nMissing configuration: ${JSON.stringify(job.missingConfig)}`,
        ['Refresh', 'Prepare', 'Configure from local JSON file', 'Authorize connection', 'Complete', 'Authorize later', 'Cancel setup', 'Close']);
      if (!choice || choice === 'Close' || !current()) return;
      if (choice === 'Refresh') { job = await run({ action: 'plugin.setup.get', id }) as PluginSetupJob; continue; }
      const base = { expectedRevision: job.revision, idempotencyKey: randomUUID() };
      if (choice === 'Configure from local JSON file') {
        const path = await context.input('Local JSON file containing plugin configuration (values will not be displayed)');
        if (!path || !current()) continue;
        if ((await stat(path)).size > 65536) throw new Error('Configuration file exceeds 64 KiB.');
        const values: Record<string, unknown> = JSON.parse(await readFile(path, 'utf8'));
        if (!values || Array.isArray(values) || typeof values !== 'object') throw new Error('Expected a JSON object.');
        job = await run({ action: 'plugin.setup', id, command: { action: 'configure', ...base, values } }) as PluginSetupJob;
      } else if (choice === 'Authorize connection') {
        const server = await context.choose('Connection', job.connections.map(connection => connection.name));
        if (!server || !current()) continue;
        job = await run({ action: 'plugin.setup', id, command: { action: 'authorize', ...base, server } }) as PluginSetupJob;
        const connection = job.connections.find(connection => connection.name === server);
        if (connection?.authorizationId) {
          const attempt = await run({ action: 'mcp.auth', id: connection.authorizationId }) as McpAuthorization | null;
          if (attempt) await auth(attempt);
        }
      } else {
        const action = choice === 'Prepare' ? 'prepare' : choice === 'Complete' ? 'complete' : choice === 'Authorize later' ? 'defer' : 'cancel';
        if ((action === 'complete' || action === 'defer') && !await confirm(`Apply ${action} for plugin ${id}?`)) continue;
        job = await run({ action: 'plugin.setup', id, command: action === 'complete' ? { action, ...base, allowPartial: false } : { action, ...base } }) as PluginSetupJob;
        if (action === 'cancel' || action === 'defer') break;
      }
    }
    view('Plugin setup', job);
  };
}
