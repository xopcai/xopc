import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SceneExecutionService } from '../execution.js';
import { SceneRepository } from '../repository.js';
import { SceneApplicationService } from '../service.js';
import { familyPlanTemplate } from '../templates.js';
import { SceneUserNotesProvider } from '../userNotes.js';

describe('personal family planning without project or task dependencies', () => {
  let db: DatabaseSync;
  let repository: SceneRepository;
  let application: SceneApplicationService;
  let provider: SceneUserNotesProvider;
  let activationId: string;
  const principal = { ownerId: 'parent', workspaceId: 'personal' };
  const permissions = { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] };
  const authorize = vi.fn(async () => permissions);
  const note = { expectedRevision: 0, content: 'Saturday: family lunch at noon. Keep Sunday free for rest.' };

  beforeEach(async () => {
    authorize.mockReset().mockResolvedValue(permissions);
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    repository = new SceneRepository(db);
    repository.installTemplate(familyPlanTemplate);
    provider = new SceneUserNotesProvider(db, () => 2000);
    application = new SceneApplicationService(repository, [provider], authorize, () => 2000);
    activationId = (await application.start(principal, { templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version,
      goal: 'Make family arrangements easier while keeping room for rest.', scope: { kind: 'personal' }, permissions }, 'start')).id;
  });
  afterEach(() => db.close());

  it('turns explicitly supplied arrangements into a cited plan while leaving the ongoing goal active', async () => {
    expect(application.writeNotes(principal, activationId, note)).toBe(1);
    application.check(principal, activationId, 'review');
    const execute = vi.fn(async ({ evidence }) => ({ kind: 'artifact', summary: 'Prepare lunch on Saturday. Leave Sunday unplanned.', evidenceIds: [evidence[0].id] }));
    const runtime = new SceneExecutionService(repository, [provider], { execute }, authorize, () => 2000);
    expect(await runtime.runNext('worker')).toBe('completed');
    expect(execute.mock.calls[0][0].evidence).toMatchObject([{ content: note.content }]);
    expect(repository.listInbox(principal)).toHaveLength(1);
    expect(repository.getActivation(principal, activationId).status).toBe('active');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('tasks', 'projects')").all()).toEqual([]);
  });

  it('does not invent arrangements or call the model when no notes were supplied', async () => {
    application.check(principal, activationId, 'review');
    const execute = vi.fn();
    const runtime = new SceneExecutionService(repository, [provider], { execute }, authorize, () => 2000);
    expect(await runtime.runNext('worker')).toBe('completed');
    expect(execute).not.toHaveBeenCalled();
    expect(repository.listInbox(principal)).toEqual([]);
    expect(repository.listRuns(principal, activationId)).toMatchObject([{ reason: 'empty_input' }]);
  });

  it('allows removing supplied notes and does not reuse removed context', async () => {
    application.writeNotes(principal, activationId, note);
    application.writeNotes(principal, activationId, { expectedRevision: 1, content: '  ' });
    expect(repository.readNotes(principal, activationId)).toMatchObject({ content: '', revision: 2 });
    application.check(principal, activationId, 'review');
    const execute = vi.fn();
    const runtime = new SceneExecutionService(repository, [provider], { execute }, authorize, () => 2000);
    expect(await runtime.runNext('worker')).toBe('completed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('prevents late results if arrangements change during execution', async () => {
    application.writeNotes(principal, activationId, note);
    application.check(principal, activationId, 'review');
    const runtime = new SceneExecutionService(repository, [provider], { execute: async () => {
      application.writeNotes(principal, activationId, { expectedRevision: 1, content: 'Cancel the lunch; keep this weekend free.' });
      return { kind: 'artifact', summary: 'Outdated lunch plan', evidenceIds: [`scene-notes:${activationId}`] };
    } }, authorize, () => 2000);
    expect(await runtime.runNext('worker')).not.toBe('completed');
    expect(repository.listInbox(principal)).toEqual([]);
    expect(db.prepare('SELECT status, reason FROM scene_runs').get()).toMatchObject({ status: 'cancelled', reason: 'source_changed' });
  });

  it('checks ownership and edit revision', () => {
    application.writeNotes(principal, activationId, note);
    expect(() => application.writeNotes(principal, activationId, note)).toThrow('changed');
    expect(() => application.writeNotes({ ...principal, ownerId: 'other' }, activationId, { ...note, expectedRevision: 1 })).toThrow('not found');
    expect(() => application.writeNotes({ ...principal, workspaceId: 'other' }, activationId, { ...note, expectedRevision: 1 })).toThrow('not found');
  });

  it('waits for renewed notes instead of presenting expired arrangements as current', async () => {
    repository.writeNotes(principal, activationId, { ...note, validUntil: 1500 }, 1000);
    application.check(principal, activationId, 'review');
    const execute = vi.fn();
    const runtime = new SceneExecutionService(repository, [provider], { execute }, authorize, () => 2000);
    expect(await runtime.runNext('worker')).toBe('deferred');
    expect(execute).not.toHaveBeenCalled();
  });

  it('withdraws an obsolete plan when notes are edited', async () => {
    application.writeNotes(principal, activationId, note);
    application.check(principal, activationId, 'review');
    const runtime = new SceneExecutionService(repository, [provider], { execute: async () => ({ kind: 'artifact', summary: 'Lunch plan', evidenceIds: [`scene-notes:${activationId}`] }) }, authorize, () => 2000);
    await runtime.runNext('worker');
    expect(repository.listInbox(principal)).toHaveLength(1);
    application.writeNotes(principal, activationId, { expectedRevision: 1, content: 'Lunch cancelled' });
    expect(repository.listInbox(principal)).toEqual([]);
  });
});
