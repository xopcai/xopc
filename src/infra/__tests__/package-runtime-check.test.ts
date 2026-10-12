import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyInstalledGatewayRuntime } from '../package-runtime-check.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

async function candidate(source: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xopc-runtime-fixture-'));
  dirs.push(root);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  const gateway = path.join(root, 'dist/src/gateway');
  await fs.mkdir(gateway, { recursive: true });
  await fs.writeFile(path.join(gateway, 'index.js'), source);
  return { root, gateway };
}

describe('installed gateway runtime validation', () => {
  it('loads a compatible gateway graph in a fresh process with isolated state', async () => {
    const { root } = await candidate(`import fs from 'node:fs';
if (!process.env.XOPC_STATE_DIR.includes('xopc-runtime-check-')) throw new Error('State not isolated');
fs.writeFileSync(process.env.XOPC_STATE_DIR + '/probe', 'safe');
export class GatewayServer {}`);
    expect(await verifyInstalledGatewayRuntime({ packageRoot: root })).toEqual([]);
  });
  it('reproduces and rejects the missing MCP_TYPESCRIPT_PREAMBLE export', async () => {
    const { root, gateway } = await candidate("import { MCP_TYPESCRIPT_PREAMBLE } from './declarations.js'; export class GatewayServer {} console.log(MCP_TYPESCRIPT_PREAMBLE);");
    await fs.writeFile(path.join(gateway, 'declarations.js'), 'export const renamed = true;');
    const errors = await verifyInstalledGatewayRuntime({ packageRoot: root });
    expect(errors.join('\n')).toContain("does not provide an export named 'MCP_TYPESCRIPT_PREAMBLE'");
  });
  it('rejects incomplete artifacts even when package version metadata exists', async () => {
    const { root } = await candidate('export const unrelated = true;');
    expect((await verifyInstalledGatewayRuntime({ packageRoot: root })).join('\n')).toContain('Missing GatewayServer export');
  });
});
