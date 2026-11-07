/** Host-owned worker. Generated application code is never loaded into this process. */
import { basename, dirname, join } from 'node:path';
import { rmSync } from 'node:fs';

import { openXopcDatabase, closeXopcDatabase, upsertNoteRecord } from '../storage/sqlite/index.js';
import { NotesService } from '../notes/service.js';
import { TaskRepository } from '../tasks/task-repository.js';
import { createProductDispatcher } from '../capabilities/runtime/product.js';
import { CapabilityError, type CapabilityContext } from '../capabilities/runtime/dispatcher.js';
import { CapabilityCallSchema, ExtensionCapabilityBindingsSchema, LocalAppResourceScopesSchema } from '@xopcai/gateway-contract';
import { PreviewFixturesSchema } from './preview-fixtures.js';
import { localAppResourceAllowed } from './capabilities/resource-policy.js';

class PreviewNotesService extends NotesService {
  // Receipts and outbox records stay in the isolated database; do not dispatch production effects.
  override flushCommittedEffects(): void {}
}

if (process.send && process.env.XOPC_LOCAL_APP_PREVIEW_WORKER === '1') {
  const directory = process.env.XOPC_STATE_DIR!;
  if (!directory || !/^run-[A-Za-z0-9_-]+$/.test(basename(directory)) || basename(dirname(directory)) !== 'preview-runs'
    || basename(dirname(dirname(directory))) !== 'local-apps') throw new Error('Invalid isolated preview directory');
  let dispatcher: ReturnType<typeof createProductDispatcher>;
  let context: CapabilityContext;
  let busy = false;
  let initialized = false;
  const close = () => { closeXopcDatabase(); rmSync(directory, { recursive: true, force: true }); process.exit(0); };
  process.on('disconnect', close);
  process.on('SIGTERM', close);
  process.on('message', async (message: { requestId: string; type: string; fixtures?: unknown; bindings?: unknown; id?: string; call?: unknown }) => {
    try {
      if (busy) throw new CapabilityError('UNAVAILABLE', 'Preview worker is busy');
      busy = true;
      if (message.type === 'init' && !initialized) {
        const fixtures = PreviewFixturesSchema.parse(message.fixtures);
        const bindings = ExtensionCapabilityBindingsSchema.parse(message.bindings);
        openXopcDatabase({ path: join(directory, 'xopc.db') });
        const now = Date.now();
        for (const note of fixtures.notes) upsertNoteRecord({ ...note, kind: 'thought', status: 'inbox',
          createdAt: now, updatedAt: now, localVersion: 1, remoteVersion: 1, capturedVia: { channel: 'web' } });
        for (const task of fixtures.tasks) new TaskRepository().create({ ...task, objective: task.title });
        const notes = new PreviewNotesService();
        dispatcher = createProductDispatcher(() => notes);
        context = { principalId: 'isolated-preview', surface: 'extension', scopes: ['gateway.admin'],
          allowedCapabilities: bindings.map(binding => binding.id), authorize: (id, input) => localAppResourceAllowed('isolated-preview', context.localApp!.resourceScopes, id, input),
          localApp: { extensionId: 'isolated-preview', resourceScopes: LocalAppResourceScopesSchema.parse({
            notesRead: { mode: 'workspace' }, notesWrite: { mode: 'workspace' }, tasksRead: { mode: 'workspace' },
          }) } };
        initialized = true;
        process.send?.({ requestId: message.requestId, data: { ready: true } });
      } else if (message.type === 'call' && initialized) {
        const call = CapabilityCallSchema.parse(message.call);
        const data = await dispatcher.call(message.id!, call.input, context, call);
        process.send?.({ requestId: message.requestId, data });
      } else throw new CapabilityError('INVALID_INPUT', 'Invalid preview worker request');
    } catch (error) {
      process.send?.({ requestId: message.requestId, error: { code: error instanceof CapabilityError ? error.code : 'INTERNAL',
        message: error instanceof CapabilityError ? error.message : 'Isolated preview operation failed',
        diagnostic: error instanceof CapabilityError ? undefined : error instanceof Error ? error.stack?.slice(0, 2000) : String(error).slice(0, 500) } });
    } finally { busy = false; }
  });
}
