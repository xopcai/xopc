import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SceneExecutionService } from '../execution.js';
import { SceneRepository } from '../repository.js';
import { installSceneStorage } from '../../storage/sqlite/scenes-schema.js';
import { SceneRuntime } from '../runtime.js';
import { SceneCapabilityRegistry } from '../registry.js';
import { SceneApplicationService } from '../service.js';
import { familyPlanTemplate } from '../templates.js';
import { SceneUserNotesProvider } from '../userNotes.js';

describe('single-Gateway scene runtime', () => {
  let db: DatabaseSync;
  let repository: SceneRepository;
  let application: SceneApplicationService;
  let runtime: SceneRuntime;
  let activationId: string;
  let now: number;
  const principal = { ownerId: 'user', workspaceId: 'personal' };
  const permissions = { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] };
  const execute = vi.fn();
  const scan = vi.fn();
  beforeEach(async () => {
    now = Date.parse('2026-09-20T09:59:00Z');
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    installSceneStorage(db);

    repository = new SceneRepository(db);
    repository.installTemplate(familyPlanTemplate);
    const provider = new SceneUserNotesProvider(db, () => now);
    const authorize = async () => permissions;
    application = new SceneApplicationService(repository, new SceneCapabilityRegistry([provider]), authorize, () => now);
    activationId = (await application.start(principal, { templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version,
      goal: 'Protect rest time', scope: { kind: 'personal' }, permissions }, 'start')).id;
    application.writeNotes(principal, activationId, { expectedRevision: 0, content: 'Keep Sunday free.' });
    execute.mockReset().mockImplementation(async ({ evidence }) => ({ kind: 'artifact', summary: 'Keep Sunday free.', evidenceIds: evidence.map((item) => item.id) }));
    scan.mockReset().mockResolvedValue({ changed: 0, unavailable: 0, nextCursor: null });
    runtime = new SceneRuntime(repository, new SceneExecutionService(repository, new SceneCapabilityRegistry([provider]), { execute }, authorize, () => now), { scan }, () => now, 100);
  });
  afterEach(async () => { await runtime.stop(); db.close(); vi.useRealTimers(); });

  it('dispatches a durable scheduled occurrence once across repeated polls', async () => {
    application.setSchedule(principal, activationId, 'weekly-review', { expectedRevision: 0, schedule: { weekdays: [0], hour: 10, minute: 0, timeZone: 'UTC' } });
    now += 60000;
    await runtime.tick(); await runtime.tick();
    expect(execute).toHaveBeenCalledOnce();
    expect(repository.listInbox(principal)).toHaveLength(1);
  });

  it('does not start overlapping model calls and continues accepting due occurrences', async () => {
    let release!: () => void;
    execute.mockImplementationOnce(async ({ evidence }) => { await new Promise<void>((resolve) => { release = resolve; }); return { kind: 'artifact', summary: 'Rest', evidenceIds: evidence.map((item) => item.id) }; });
    application.check(principal, activationId, 'check');
    const first = runtime.tick();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    application.setSchedule(principal, activationId, 'weekly-review', { expectedRevision: 0, schedule: { weekdays: [0], hour: 10, minute: 0, timeZone: 'UTC' } });
    now += 60000;
    const second = runtime.tick();
    expect(db.prepare("SELECT count(*) AS n FROM scene_trigger_intents WHERE trigger_key = 'weekly-review'").get()?.n).toBe(1);
    expect(execute).toHaveBeenCalledOnce();
    release(); await Promise.all([first, second]);
  });

  it('cancels a non-cooperative model on stop and discards its late output', async () => {
    let release!: () => void;
    execute.mockImplementationOnce(async ({ evidence }) => { await new Promise<void>((resolve) => { release = resolve; }); return { kind: 'artifact', summary: 'Late', evidenceIds: evidence.map((item) => item.id) }; });
    application.check(principal, activationId, 'check');
    const pending = runtime.tick();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await runtime.stop(); await pending;
    release(); await Promise.resolve();
    expect(repository.listInbox(principal)).toEqual([]);
    await expect(runtime.tick()).rejects.toThrow('stopped');
  });

  it('starts only one timer and stops before host database closure', async () => {
    vi.useFakeTimers();
    application.check(principal, activationId, 'check');
    runtime.start(); runtime.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(execute).toHaveBeenCalledOnce();
    await runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('advances observation pages and wraps to detect later changes', async () => {
    scan.mockResolvedValueOnce({ changed: 0, unavailable: 0, nextCursor: 'page-1' });
    await runtime.tick(); await runtime.tick(); await runtime.tick();
    expect(scan.mock.calls.map((call) => call[1])).toEqual(['', 'page-1', '']);
  });

  it('observes new mail while a model call is still running', async () => {
    let release!: () => void;
    execute.mockImplementationOnce(async ({ evidence }) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { kind: 'artifact', summary: 'Rest', evidenceIds: evidence.map((item) => item.id) };
    });
    application.check(principal, activationId, 'check');
    const first = runtime.tick();
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
    const second = runtime.tick();
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
    expect(execute).toHaveBeenCalledOnce();
    release(); await Promise.all([first, second]);
  });

  it('does not overlap scans and stops waiting for a non-cooperative source', async () => {
    let release!: (value: { changed: number; unavailable: number; nextCursor: string }) => void;
    scan.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = runtime.tick();
    const second = runtime.tick();
    const settled = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
    await runtime.stop();
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
    release({ changed: 0, unavailable: 0, nextCursor: 'late-cursor' });
    await Promise.resolve();
    runtime.start();
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
    expect(scan.mock.calls[1][1]).toBe('');
  });

  it('times out a stuck scan and can retry the same page', async () => {
    vi.useFakeTimers();
    scan.mockImplementationOnce(() => new Promise(() => {}));
    const result = expect(runtime.tick()).rejects.toThrow('observation timed out');
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    await runtime.tick();
    expect(scan.mock.calls.map((call) => call[1])).toEqual(['', '']);
  });
});
