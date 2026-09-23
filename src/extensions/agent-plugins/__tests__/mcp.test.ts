import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentPluginStore } from '../store.js';
import { MCP_SCHEMA, PLUGIN_SCHEMA } from '../validation.js';
import { materializePluginServers } from '../mcp-adapter.js';
import { createSessionMcpRuntime } from '../../../agent/mcp/bundle-mcp-runtime.js';
import { createPluginHttpFetch } from '../../../agent/mcp/plugin-http-fetch.js';
import { McpToolProvider } from '../../../agent/external-tools/mcp-provider.js';

const roots: string[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), 'xopc-plugin-mcp-')); roots.push(root); return root; };
afterEach(() => { vi.unstubAllEnvs(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
it('runs plugin stdio through the existing runtime and creates persistent data only on launch', async () => {
  const source = temp(); const state = temp(); vi.stubEnv('XOPC_STATE_DIR', state);
  const store = new AgentPluginStore(state);
  writeFileSync(join(source, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'runtime' }));
  writeFileSync(join(source, 'mcp.json'), JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: {
    main: { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/server.cjs'] },
  } }));
  writeFileSync(join(source, 'server.cjs'), `const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', line => {
const m=JSON.parse(line); if(m.id === undefined)return;
const result = m.method === 'initialize' ? {protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}} : m.method === 'tools/list' ? {tools:[{name:'echo',inputSchema:{type:'object'}}]} : m.method === 'tools/call' ? {content:[{type:'text',text:process.env.PLUGIN_DATA}]} : {};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n'); });`);
  const plugin = store.install(source, { reviewHash: store.inspect(source).reviewHash });
  store.setEnabled(plugin.id, true);
  expect(existsSync(store.dataDir(plugin.id))).toBe(false);
  const server = materializePluginServers(store.get(plugin.id)!, store)['plugin/runtime/main'];
  expect((server.env as Record<string, string>).PLUGIN_ROOT).toBe(plugin.rootDir);
  const runtime = createSessionMcpRuntime({ sessionId: 'plugin-test', workspaceDir: state });
  try {
    expect((await runtime.getCatalog()).tools).toHaveLength(1);
    expect(await runtime.callTool('plugin/runtime/main', 'echo', {})).toMatchObject({ content: [{ text: store.dataDir(plugin.id) }] });
    expect(existsSync(store.dataDir(plugin.id))).toBe(true);
    expect(store.get(plugin.id)?.readiness).toBe('ready');
  } finally { await runtime.dispose(); }
});
it('blocks redirect credential forwarding and private network requests', async () => {
  let leaked = false;
  const sink = createServer((_req, res) => { leaked = true; res.end(); });
  await new Promise<void>(r => sink.listen(0, '127.0.0.1', r));
  const source = createServer((_req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${(sink.address() as {port:number}).port}` }); res.end(); });
  await new Promise<void>(r => source.listen(0, '127.0.0.1', r));
  try {
    const url = new URL(`http://127.0.0.1:${(source.address() as {port:number}).port}`);
    await expect(createPluginHttpFetch(url, { Authorization: 'secret' })(url)).rejects.toThrow();
    expect(leaked).toBe(false);
    await expect(createPluginHttpFetch(new URL('https://example.com'), {})('https://169.254.169.254')).rejects.toThrow('private');
    await expect(createPluginHttpFetch(new URL('https://example.com'), {})('https://[::ffff:127.0.0.1]')).rejects.toThrow('private');
  } finally { source.closeAllConnections(); sink.closeAllConnections(); await Promise.all([new Promise<void>(r => source.close(() => r())), new Promise<void>(r => sink.close(() => r()))]); }
});
it('turns a real MCP 401 into a connection candidate without starting authorization', async () => {
  const source = temp(); const state = temp(); vi.stubEnv('XOPC_STATE_DIR', state);
  const server = createServer((_req, response) => { response.writeHead(401); response.end('Authorization required'); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const store = new AgentPluginStore(state);
  writeFileSync(join(source, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'needs-account' }));
  writeFileSync(join(source, 'mcp.json'), JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: {
    main: { type: 'streamable-http', url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp` },
  } }));
  store.install(source, { reviewHash: store.inspect(source).reviewHash }); store.setEnabled('needs-account', true);
  const runtime = createSessionMcpRuntime({ sessionId: 'auth-required', workspaceDir: state });
  try {
    const provider = new McpToolProvider({ workspace: state, getConfig: () => undefined, getConversationId: () => undefined, getRuntime: async () => runtime });
    expect(await provider.search('needs-account')).toEqual([]);
    expect(await provider.connectionCandidates('needs-account')).toEqual([
      expect.objectContaining({ candidateRef: 'plugin-mcp:needs-account:main', reason: 'not_connected' }),
    ]);
    expect(store.get('needs-account')?.readiness).toBe('setup_required');
  } finally {
    await runtime.dispose(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  }
});
