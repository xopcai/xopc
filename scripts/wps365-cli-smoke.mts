/** Verify the pinned WPS binary against isolated fixtures; no real account or business writes. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { wps365Adapter } from '../src/connectors/cli/adapters/wps365.js';
import { installCli } from '../src/connectors/cli/installer.js';
import { startCliProcess } from '../src/connectors/cli/process.js';

const directory = await mkdtemp(join(tmpdir(), 'wps365-smoke-'));
const previousState = process.env.XOPC_STATE_DIR;
process.env.XOPC_STATE_DIR = directory;
let requests = 0;
const server = createServer((_request, response) => {
  requests++;
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ code: 0, data: { id: 'fixture-user', company_id: 'fixture-company', user_name: 'Fixture' } }));
});
try {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const executable = process.env.XOPC_WPS365_BINARY ?? await installCli(wps365Adapter);
  const adapter = { ...wps365Adapter, environment: { ...wps365Adapter.environment,
    WPS365_ACCESS_TOKEN: 'fixture-token', WPS365_API_BASE: origin } };
  for (const action of Object.values(adapter.staticActions!)) {
    const schema = action.inputSchema as { required?: string[]; properties: Record<string, { type: string }> };
    const input = Object.fromEntries((schema.required ?? []).map(key => [key,
      schema.properties[key]!.type === 'integer' ? 1 : ['start', 'end'].includes(key) ? '2026-09-20T00:00:00+08:00' : 'fixture']));
    const handle = await startCliProcess({ adapter, executable, contextId: 'fixture', args: ['--dry-run', ...adapter.actionArgs(action, input)] });
    const result = await handle.completion;
    assert.equal(result.exitCode, 0, action.id);
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.auth_mode, 'delegated', action.id);
    assert(preview.url.startsWith(origin + '/'), action.id);
  }
  assert.equal(requests, 0, 'Dry runs must not perform business requests');
  const identity = await startCliProcess({ adapter, executable, contextId: 'fixture', args: adapter.statusArgs });
  assert.equal(adapter.decodeIdentity(await identity.completion).key, 'fixture-company:fixture-user');
  assert.equal(requests, 1);
  const unauthenticated = { ...wps365Adapter, environment: { ...wps365Adapter.environment,
    WPS365_API_BASE: origin, WPS365_TOKEN_URL: origin + '/token',
    WPS365_CLIENT_ID: 'fixture-client', WPS365_CLIENT_SECRET: 'fixture-secret' } };
  const missing = await startCliProcess({ adapter: unauthenticated, executable, contextId: 'missing-user', args: adapter.statusArgs });
  assert.notEqual((await missing.completion).exitCode, 0);
  assert.equal(requests, 1, 'Explicit delegated identity must not acquire an app token');
  console.log('WPS: 14 pinned read contracts, identity envelope, isolated specs and no app fallback passed.');
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (previousState === undefined) delete process.env.XOPC_STATE_DIR;
  else process.env.XOPC_STATE_DIR = previousState;
  await rm(directory, { recursive: true, force: true });
}
