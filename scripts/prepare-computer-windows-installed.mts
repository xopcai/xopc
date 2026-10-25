/** Seed only the disposable installed-app validation database, before it has an owner. */
import assert from 'node:assert/strict';
import { basename, dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';
import { AgentCatalogRepository } from '../src/agent-catalog/repository.js';
import { AgentDefaultsSchema } from '../src/agent-config/index.js';

const root = process.env.XOPC_STATE_DIR!;
assert.match(basename(dirname(root)), /^installed-windows-[a-f0-9-]{36}$/);
const workspace = join(root, 'workspace');
await mkdir(workspace, { recursive: true });
await writeFile(join(workspace, 'AGENTS.md'), 'Use computer_use for the authorized disposable GUI test. Do not use shell or other applications.\n');
openXopcDatabase({ path: join(root, 'xopc.db') });
try {
  const catalog = new AgentCatalogRepository();
  catalog.ensureInitialized(AgentDefaultsSchema.parse({ models: {
    chat: { primary: 'xopc-cloud/auto' }, computerUse: { primary: 'xopc-cloud/computer' },
  }, skills: { mode: 'selected', include: [] }, runtime: { thinkingLevel: 'low', maxTurns: 20, timeoutMs: 480_000 },
  tools: { computer_use: { mode: 'allow', timeoutMs: 180_000 }, exec: { mode: 'deny' }, bash: { mode: 'deny' } } }));
  catalog.create({ id: 'installed-validation', workspace, profile: { name: 'Disposable installation validation' } }, { ready: true });
} finally { closeXopcDatabase(); }
