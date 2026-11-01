import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { COMPUTER_DESCRIPTOR, COMPUTER_FRAME_MAX_BYTES } from '@xopcai/computer-control-contract';
import { ENDPOINT_PROTOCOL_VERSION } from '@xopcai/endpoint-tools-protocol';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import { expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

import { XOPC_DB_SCHEMA_VERSION } from '../../src/storage/sqlite/schema.js';
import { closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../src/storage/sqlite/connection.js';
import { ensureGatewayConfigForElectron } from '../ensure-gateway-config.js';

it('uses an authenticated compatible older Gateway catalog without upgrading or initializing its database', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-older-local-'));
  const dbPath = join(root, 'xopc.db'), db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT); INSERT INTO schema_meta VALUES ('schema_version', '${XOPC_DB_SCHEMA_VERSION - 1}');`); db.close();
  const before = await readFile(dbPath), workspace = join(root, 'custom-workspace');
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer test-owner') { res.writeHead(401).end('{}'); return; }
    const value = req.url === '/api/endpoint-tools/compatibility' ? { ok: true, payload: {
      realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION, endpointProtocolVersion: ENDPOINT_PROTOCOL_VERSION,
      computerFrameUploadMaxBytes: COMPUTER_FRAME_MAX_BYTES, computerControl: COMPUTER_DESCRIPTOR,
    } } : req.url === '/api/agents' ? { ok: true, payload: { defaultId: 'main', agents: [{ id: 'main', workspace }] } } : { ok: true };
    res.end(JSON.stringify(value));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const port = (server.address() as { port: number }).port, configPath = join(root, 'xopc.json');
    const config = JSON.stringify({ gateway: { port, auth: { mode: 'token', token: 'test-owner' } } }); await writeFile(configPath, config);
    vi.stubEnv('XOPC_STATE_DIR', root);
    const paths = { stateDir: root, electronUserData: join(root, 'electron'), configPath, workspacePath: join(root, 'workspace/main') };
    const result = await ensureGatewayConfigForElectron(paths);
    expect(result.port).toBe(port); expect(result.fileIpcRoots).toEqual([paths.electronUserData, workspace, join(root, 'agents/main/profile')]);
    expect(await readFile(dbPath)).toEqual(before); expect(await readFile(configPath, 'utf8')).toBe(config);
  } finally {
    vi.unstubAllEnvs(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true });
  }
});

it('keeps the original cold initializer for an existing empty database file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-empty-local-'));
  closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
  try {
    vi.stubEnv('XOPC_STATE_DIR', root); vi.stubEnv('XOPC_CONFIG_PATH', join(root, 'xopc.json')); vi.stubEnv('XOPC_WORKSPACE', join(root, 'workspace/main'));
    await writeFile(join(root, 'xopc.db'), '');
    await writeFile(join(root, 'xopc.json'), JSON.stringify({ gateway: { port: 18790, auth: { mode: 'token', token: 'test-owner' } } }));
    const result = await ensureGatewayConfigForElectron({ stateDir: root, electronUserData: join(root, 'electron'), configPath: join(root, 'xopc.json'), workspacePath: join(root, 'workspace/main') });
    expect(result.token).toBe('test-owner');
    const db = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
    try { expect(Number(db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()?.value)).toBe(XOPC_DB_SCHEMA_VERSION); }
    finally { db.close(); }
  } finally { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});
