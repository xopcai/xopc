import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import { discoverMcpTools } from '../tool-catalog.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'xopc-mcp-catalog-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', root);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

it('discovers schemas and hidden tools with a native stdio session without model credentials', async () => {
  const script = join(root, 'server.mjs');
  await writeFile(script, `import {createInterface} from 'node:readline';
    createInterface({input:process.stdin}).on('line', line => {
      const q = JSON.parse(line); if (q.id === undefined) return;
      const result = q.method === 'initialize' ? {protocolVersion:'2025-03-26', serverInfo:{name:'fixture',version:'1'}, capabilities:{tools:{}}}
        : q.method === 'tools/list' ? {tools:['lookup','secret'].map(name => ({name,description:'Find a note',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}}))}
        : {};
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');
    });`);
  const config = ConfigSchema.parse({ mcp: { servers: { 'my-docs': { command: process.execPath, args: [script],
    toolExposure: { secret: 'hidden' } } } } });
  const tools = await discoverMcpTools(config, root, 'my-docs');
  expect(tools.map(tool => tool.name)).toEqual(['mcp__my_docs__lookup', 'mcp__my_docs__secret']);
  expect(tools[0].inputSchema).toMatchObject({ properties: { query: { type: 'string' } }, required: ['query'] });
  expect(tools[1].exposure).toBe('hidden');
});

it('reports a failed connection instead of returning an empty catalog', async () => {
  const config = ConfigSchema.parse({ mcp: { servers: { broken: { command: join(root, 'missing') } } } });
  await expect(discoverMcpTools(config, root, 'broken')).rejects.toThrow('MCP servers need attention');
});

it('rejects disabled and missing servers before starting a connection', async () => {
  const config = ConfigSchema.parse({ mcp: { servers: { disabled: { command: 'unused', enabled: false } } } });
  await expect(discoverMcpTools(config, root, 'disabled')).rejects.toThrow('disabled');
  await expect(discoverMcpTools(config, root, 'missing')).rejects.toThrow('not configured');
});
