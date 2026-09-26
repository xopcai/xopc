import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CapabilityDispatcher, type CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { DomainOutboxDispatcher } from '../../infra/domain-outbox-dispatcher.js';
import { listAutomationEvents } from '../../automations/events/index.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { registerSceneWriteCapabilities } from '../capabilities/write.js';
import { SceneExecutionService } from '../execution.js';
import type { SceneHttpServices } from '../httpServices.js';
import { SceneRepository } from '../repository.js';
import { SceneApplicationService } from '../service.js';
import { familyPlanTemplate } from '../templates.js';
import { SceneUserNotesProvider } from '../userNotes.js';
import { SceneCapabilityRegistry } from '../registry.js';

describe('durable scene resource events', () => {
  let directory: string;
  let repository: SceneRepository;
  let application: SceneApplicationService;
  let id: string;
  const principal = { ownerId: 'local-owner', workspaceId: 'workspace' };
  const permissions = { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] };
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-scene-events-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    repository = new SceneRepository(getSqliteDatabase());
    repository.installTemplate(familyPlanTemplate);
    application = new SceneApplicationService(repository, new SceneCapabilityRegistry([new SceneUserNotesProvider(getSqliteDatabase())]), async () => permissions);
    id = (await application.start(principal, { templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version,
      goal: 'Plan the week', scope: { kind: 'personal' }, permissions }, 'start')).id;
  });
  afterEach(() => {
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });
  const events = () => getSqliteDatabase().prepare("SELECT * FROM domain_outbox WHERE subject_kind = 'scene' ORDER BY rowid").all();

  it('rolls back aggregate revisions and outbox records with the business change', () => {
    const before = events();
    const revision = getSqliteDatabase().prepare('SELECT revision FROM scene_resource_revisions WHERE resource_id = ?').get(id);
    expect(() => runSqliteWriteTransaction(() => {
      application.writeNotes(principal, id, { expectedRevision: 0, content: 'Not committed' });
      throw new Error('abort');
    })).toThrow('abort');
    expect(events()).toEqual(before);
    expect(getSqliteDatabase().prepare('SELECT revision FROM scene_resource_revisions WHERE resource_id = ?').get(id)).toEqual(revision);
  });

  it('links capability changes to one operation and does not emit again on replay', async () => {
    const dispatcher = new CapabilityDispatcher();
    registerSceneWriteCapabilities(dispatcher, () => ({ principal, services: { application } as SceneHttpServices }));
    const context: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['gateway.admin'], authorize: () => true };
    const operation = 'xopc.scenes.notes';
    const options = { ...dispatcher.describe(operation, context), idempotencyKey: 'notes' };
    const before = events().length;
    await dispatcher.call(operation, { id, expectedRevision: 0, content: 'Committed' }, context, options);
    const committed = events();
    expect(committed.length).toBeGreaterThan(before);
    const operationId = getSqliteDatabase().prepare('SELECT operation_id FROM capability_operations').get()!.operation_id;
    expect(committed.slice(before).every(event => event.operation_id === operationId)).toBe(true);
    await dispatcher.call(operation, { id, expectedRevision: 0, content: 'Committed' }, context, options);
    expect(events()).toEqual(committed);
  });

  it('records background results and skips heartbeat-only lease updates', async () => {
    application.writeNotes(principal, id, { expectedRevision: 0, content: 'Keep Sunday free' });
    application.check(principal, id, 'check');
    const now = Date.now();
    const claim = repository.claimNext('lease-test', now)!;
    const count = events().length;
    expect(repository.renewLease(claim, now + 1, 120000)).toBe(true);
    expect(events()).toHaveLength(count);
    repository.failRun(claim, now + 2, 'test-finished');
    application.check(principal, id, 'second-check');
    const before = events().length;
    const runtime = new SceneExecutionService(repository, new SceneCapabilityRegistry([new SceneUserNotesProvider(getSqliteDatabase())]), {
      execute: async ({ evidence }) => ({ kind: 'artifact', summary: 'Sunday is free.', evidenceIds: evidence.map(item => item.id) }),
    }, async () => permissions);
    await runtime.runNext('background');
    expect(repository.listInbox(principal)).toHaveLength(1);
    expect(events().length).toBeGreaterThan(before);
    const revisions = events().filter(event => event.subject_id === id).map(event => JSON.parse(String(event.payload_json)).revision);
    expect(new Set(revisions).size).toBe(revisions.length);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
  });

  it('recovers unpublished events and operation context registration after reopening', () => {
    const before = events().length;
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    repository = new SceneRepository(getSqliteDatabase());
    repository.writeNotes(principal, id, { expectedRevision: 0, content: 'After reopen' }, Date.now());
    expect(events().length).toBeGreaterThan(before);
    const dispatcher = new DomainOutboxDispatcher();
    expect(dispatcher.drain(100, 'scene')).toBe(events().length);
    expect(listAutomationEvents({ source: 'scenes' }).map(event => event.type)).toContain('scene.changed');
    expect(dispatcher.drain(100, 'scene')).toBe(0);
  });
});
