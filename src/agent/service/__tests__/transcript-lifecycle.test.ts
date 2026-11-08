import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';
import { ConfigSchema } from '../../../config/schema.js';
import { MessageBus } from '../../../infra/bus/index.js';
import { emitSessionTranscriptUpdate } from '../../../session/transcript-events.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { AgentService } from '../../service.js';

describe('AgentService transcript listener lifecycle', () => {
  let directory: string;
  const services: AgentService[] = [];
  afterEach(async () => {
    for (const service of services.splice(0)) await service.stop();
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('only syncs the active service after stopping and replacing the gateway agent', async () => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-transcript-lifecycle-'));
    vi.stubEnv('XOPC_STATE_DIR', directory);
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'test.db') });
    const catalog = new AgentCatalogRepository(); catalog.ensureInitialized();
    catalog.markProvisioned('main');
    const makeService = () => {
      const service = new AgentService(new MessageBus(), { workspace: directory, config: ConfigSchema.parse({}) });
      services.push(service);
      const store = (service as unknown as { sessionStore: { syncEmbeddedTranscriptUpdate: () => Promise<void> } }).sessionStore;
      return { service, sync: vi.spyOn(store, 'syncEmbeddedTranscriptUpdate').mockResolvedValue() };
    };
    const old = makeService();
    const update = { conversationId: 'synthetic-lifecycle', message: { role: 'user', content: 'synthetic' } };
    emitSessionTranscriptUpdate(update);
    expect(old.sync).toHaveBeenCalledTimes(1);
    await old.service.stop();
    const current = makeService();
    emitSessionTranscriptUpdate(update);
    expect(old.sync).toHaveBeenCalledTimes(1);
    expect(current.sync).toHaveBeenCalledTimes(1);
    await current.service.stop();
    emitSessionTranscriptUpdate(update);
    expect(current.sync).toHaveBeenCalledTimes(1);
  });
});
