import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
}));

const paths = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join: joinPath } = require('node:path') as typeof import('node:path');
  return { root: joinPath(tmpdir(), `xopc-local-app-test-${process.pid}-${Date.now()}`) };
});

vi.mock('../../config/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/paths.js')>();
  return {
    ...actual,
    resolveExtensionsDir: () => join(paths.root, 'extensions'),
    resolveStateDir: () => paths.root,
  };
});

import type { Config } from '../../config/schema.js';
import { ExtensionLoader } from '../../extensions/index.js';
import { ProjectService } from '../../projects/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { LocalAppService } from '../service.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import type { CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { createXopcUseTool } from '../../agent/tools/xopc-use-tool.js';
import { ChatPreviewService } from '../../chat-previews/index.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';

describe('LocalAppService', () => {
  let config: Config;
  let projects: ProjectService;
  let service: LocalAppService;
  let events: string[];
  let extensionLoader: ExtensionLoader;

  beforeEach(() => {
    rmSync(paths.root, { recursive: true, force: true });
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(paths.root, 'xopc.db') });
    config = { extensions: { disabled: ['placeholder'] } } as unknown as Config;
    projects = new ProjectService();
    events = [];
    extensionLoader = new ExtensionLoader({
      extensionsDir: join(paths.root, 'extensions'),
      workspaceExtensionsDir: join(paths.root, 'workspace-extensions'),
    });
    service = new LocalAppService({
      projects,
      workspaceRoot: join(paths.root, 'workspace'),
      getConfig: () => config,
      saveConfig: async (next) => {
        config = next;
        return { saved: true };
      },
      getExtensionLoader: () => extensionLoader,
      emit: (type) => events.push(type),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(paths.root, { recursive: true, force: true });
  });

  function acceptCurrentDraft(appId: string) {
    const validation = service.validate(appId);
    if (!validation.sourceHash) throw new Error('Expected a source hash');
    return service.recordAcceptance(appId, {
      sourceHash: validation.sourceHash,
      status: 'passed',
      interactiveCount: 1,
      checks: [
        { id: 'document', status: 'passed', message: 'Preview document loaded' },
        { id: 'content', status: 'passed', message: 'Visible content rendered' },
        { id: 'interaction', status: 'passed', message: '1 interactive control is discoverable' },
        { id: 'criteria', status: 'passed', message: '1 product scenario passed' },
      ],
    });
  }

  function interrupted(appId: string) {
    const root = join(paths.root, 'local-apps', 'pending-releases');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, appId), '');
    return join(root, appId);
  }

  it('promotes preview source into exactly one local app project', () => {
    const conversationId = createConversation({ agentId: 'main', sourceChannel: 'webchat' }).key;
    const previews = new ChatPreviewService({ localApps: service });
    const preview = previews.create(conversationId, {
      title: 'Login preview',
      markup: '<main><button id="sign-in">Sign in</button></main>',
      styles: 'main { padding: 24px; }',
      script: "document.querySelector('#sign-in')?.addEventListener('click', () => undefined);",
      preferredHeight: 480,
    });
    const before = (getSqliteDatabase().prepare('SELECT count(*) AS count FROM projects').get() as { count: number }).count;
    const app = previews.promote(preview.preview.id, preview.revision.sourceHash);
    expect(previews.promote(preview.preview.id, preview.revision.sourceHash).id).toBe(app.id);
    const after = (getSqliteDatabase().prepare('SELECT count(*) AS count FROM projects').get() as { count: number }).count;

    expect(after - before).toBe(1);
    expect(readFileSync(join(app.workspaceRoot, 'ui/index.html'), 'utf8')).toContain('id="sign-in"');
    expect(readFileSync(join(app.workspaceRoot, 'ui/styles.css'), 'utf8')).toBe('main { padding: 24px; }');
    expect(readFileSync(join(app.workspaceRoot, 'ui/app.js'), 'utf8')).toContain("querySelector('#sign-in')");
    expect(service.validate(app.id).status).toBe('healthy');
  });

  it('recovers interrupted upgrade files and config from the committed release, idempotently', async () => {
    const app = service.create({ name: 'Recovery fixture', idea: 'Recover interrupted upgrade' });
    acceptCurrentDraft(app.id);
    const first = await service.install(app.id);
    const target = join(paths.root, 'extensions', app.extensionId);
    const original = readFileSync(join(target, 'ui/app.js'), 'utf8');
    writeFileSync(join(target, 'ui/app.js'), 'uncommitted code');
    const orphan = join(paths.root, 'local-apps', 'releases', app.id, `v${first.draftVersion}`);
    mkdirSync(orphan, { recursive: true });
    writeFileSync(join(orphan, 'retained.txt'), 'uncommitted artifact');
    const marker = interrupted(app.id);
    config = { ...config, extensions: { enabled: ['unrelated'], disabled: [app.extensionId] } } as Config;
    await service.recoverPendingReleases();
    expect(readFileSync(join(target, 'ui/app.js'), 'utf8')).toBe(original);
    expect(config.extensions?.enabled).toEqual(expect.arrayContaining(['unrelated', app.extensionId]));
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(orphan)).toBe(false);
    expect(service.get(app.id)?.activeReleaseId).toBe(first.activeReleaseId);
    await service.recoverPendingReleases();
  });

  it('recovers a committed uninstall and a committed disable without restoring old state', async () => {
    const app = service.create({ name: 'Committed recovery', idea: 'Recover post-commit crash' });
    acceptCurrentDraft(app.id);
    await service.install(app.id);
    await service.setEnabled(app.id, false);
    interrupted(app.id);
    config = { ...config, extensions: { enabled: [app.extensionId] } } as Config;
    await service.recoverPendingReleases();
    expect(config.extensions?.disabled).toContain(app.extensionId);
    await service.uninstall(app.id);
    const target = join(paths.root, 'extensions', app.extensionId);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'stale.txt'), 'stale');
    interrupted(app.id);
    await service.recoverPendingReleases();
    expect(existsSync(target)).toBe(false);
    expect(config.extensions?.disabled).not.toContain(app.extensionId);
  });

  it('fails closed and retains the marker when the recovery artifact is corrupt', async () => {
    const app = service.create({ name: 'Corrupt recovery', idea: 'Reject corrupt release' });
    acceptCurrentDraft(app.id);
    await service.install(app.id);
    writeFileSync(join(paths.root, 'local-apps', 'releases', app.id, 'v1', 'ui/app.js'), 'corrupt');
    const marker = interrupted(app.id);
    await expect(service.recoverPendingReleases()).rejects.toThrow('integrity');
    expect(existsSync(marker)).toBe(true);
    await expect(service.setEnabled(app.id, false)).rejects.toThrow('integrity');
  });

  it('keeps recovery retryable when configuration persistence fails', async () => {
    const app = service.create({ name: 'Retry recovery', idea: 'Retry config persistence' });
    const marker = interrupted(app.id);
    const failing = new LocalAppService({
      projects, workspaceRoot: join(paths.root, 'workspace'), getConfig: () => config,
      saveConfig: async () => ({ saved: false, error: 'Injected disk failure' }),
      getExtensionLoader: () => extensionLoader, emit: () => {},
    });
    await expect(failing.recoverPendingReleases()).rejects.toThrow('Injected disk failure');
    expect(existsSync(marker)).toBe(true);
    await service.recoverPendingReleases();
    expect(existsSync(marker)).toBe(false);
  });

  it('serializes installs across service instances without losing activation config', async () => {
    const first = service.create({ name: 'First concurrent app', idea: 'First release' });
    const second = service.create({ name: 'Second concurrent app', idea: 'Second release' });
    acceptCurrentDraft(first.id);
    acceptCurrentDraft(second.id);
    let resume!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const other = new LocalAppService({
      projects,
      workspaceRoot: join(paths.root, 'workspace'),
      getConfig: () => config,
      saveConfig: async (next) => {
        entered();
        await gate;
        config = next;
        return { saved: true };
      },
      getExtensionLoader: () => extensionLoader,
      emit: (type) => events.push(type),
    });
    const installingFirst = other.install(first.id);
    await started;
    const installingSecond = service.install(second.id);
    await Promise.resolve();
    expect(existsSync(join(paths.root, 'extensions', second.extensionId))).toBe(false);
    resume();
    await Promise.all([installingFirst, installingSecond]);
    expect(config.extensions?.enabled).toEqual(expect.arrayContaining([first.extensionId, second.extensionId]));
    expect(service.get(first.id)?.installationState).toBe('installed');
    expect(service.get(second.id)?.installationState).toBe('installed');
  });

  it('orders install, disable and uninstall and releases the lock after rejection', async () => {
    const app = service.create({ name: 'Ordered app', idea: 'Serialize release lifecycle' });
    await expect(service.install(app.id)).rejects.toThrow('acceptance');
    acceptCurrentDraft(app.id);
    await Promise.all([service.install(app.id), service.setEnabled(app.id, false), service.uninstall(app.id)]);
    expect(service.get(app.id)?.installationState).not.toBe('installed');
    expect(config.extensions?.enabled).not.toContain(app.extensionId);
    expect(config.extensions?.disabled).not.toContain(app.extensionId);
    expect(existsSync(join(paths.root, 'extensions', app.extensionId))).toBe(false);
    expect(events.indexOf('local_app.installed')).toBeLessThan(events.indexOf('local_app.disabled'));
    expect(events.indexOf('local_app.disabled')).toBeLessThan(events.indexOf('local_app.uninstalled'));
  });

  it('preserves the installed release when activation staging copy fails', async () => {
    const app = service.create({ name: 'Copy failure', idea: 'Preserve active release' });
    acceptCurrentDraft(app.id);
    const installed = await service.install(app.id);
    const copy = fs.cpSync;
    vi.spyOn(fs, 'cpSync').mockImplementation((source, target, options) => {
      if (String(target).includes('.local-app-activate-')) throw new Error('Injected copy failure');
      return copy(source, target, options);
    });
    await expect(service.rollback(app.id, installed.activeReleaseId!)).rejects.toThrow('Injected copy failure');
    expect(service.get(app.id)?.activeReleaseId).toBe(installed.activeReleaseId);
    expect(existsSync(join(paths.root, 'extensions', app.extensionId, 'package.json'))).toBe(true);
  });

  it('keeps a committed release successful when temporary cleanup fails', async () => {
    const app = service.create({ name: 'Cleanup failure', idea: 'Preserve committed release' });
    acceptCurrentDraft(app.id);
    const remove = fs.rmSync;
    vi.spyOn(fs, 'rmSync').mockImplementation((path, options) => {
      if (String(path).includes('.local-app-activate-') || String(path).includes('.draft-')) {
        throw new Error('Injected cleanup failure');
      }
      return remove(path, options);
    });
    const installed = await service.install(app.id);
    expect(installed.installationState).toBe('installed');
    expect(existsSync(join(paths.root, 'local-apps', 'releases', app.id, 'v1'))).toBe(true);
    expect(existsSync(join(paths.root, 'extensions', app.extensionId, 'package.json'))).toBe(true);
  });

  it('commits acceptance, its receipt and event atomically and preserves explicit new intent', async () => {
    const app = service.create({ name: 'Acceptance fixture', idea: 'Verify acceptance transactions' });
    const previous = acceptCurrentDraft(app.id);
    events.length = 0;
    const input = { id: app.id, sourceHash: previous.sourceHash, status: previous.status,
      checks: previous.checks, interactiveCount: previous.interactiveCount };
    const runtime = createProductDispatcher(undefined, { getLocalApps: () => service });
    const caller: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['gateway.admin'], authorize: () => true };
    const operation = 'xopc.local_apps.record_acceptance';
    const invoke = (key = 'accept') => runtime.call(operation, input, caller, { ...runtime.describe(operation, caller), idempotencyKey: key });
    const record = service.recordAcceptance.bind(service);
    const failure = vi.spyOn(service, 'recordAcceptance').mockImplementationOnce((...args) => {
      record(...args);
      throw new Error('Fault after write');
    });
    await expect(invoke()).rejects.toBeDefined();
    expect(service.get(app.id)?.acceptanceRuns).toHaveLength(1);
    expect(events).toEqual([]);
    failure.mockRestore();
    const result = await invoke();
    expect(await invoke()).toEqual(result);
    expect(service.get(app.id)?.acceptanceRuns).toHaveLength(2);
    expect(events).toEqual(['local_app.acceptance_recorded']);
    const rows = getSqliteDatabase().prepare("SELECT operation_id FROM domain_outbox WHERE subject_kind = 'local_app' AND operation_id IS NOT NULL").all();
    expect(rows).toHaveLength(1);
    await invoke('new-intent');
    expect(service.get(app.id)?.acceptanceRuns).toHaveLength(3);
    await expect(runtime.call(operation, { ...input, sourceHash: '0'.repeat(64) }, caller,
      { ...runtime.describe(operation, caller), idempotencyKey: 'stale' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(runtime.call(operation, { ...input, checks: input.checks.map(check => ({ ...check, status: 'skipped' })) }, caller,
      { ...runtime.describe(operation, caller), idempotencyKey: 'skipped' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const flush = vi.spyOn(service, 'flushAcceptanceEvents').mockImplementation(() => { throw new Error('Publisher offline'); });
    await expect(invoke('pending-event')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(service.get(app.id)?.acceptanceRuns).toHaveLength(4);
    expect(getSqliteDatabase().prepare("SELECT count(*) AS n FROM domain_outbox WHERE subject_kind = 'local_app' AND published_at IS NULL").get()!.n).toBe(1);
    flush.mockRestore();
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(paths.root, 'xopc.db') });
    await invoke('pending-event');
    expect(service.get(app.id)?.acceptanceRuns).toHaveLength(4);
    expect(getSqliteDatabase().prepare("SELECT count(*) AS n FROM domain_outbox WHERE subject_kind = 'local_app' AND published_at IS NULL").get()!.n).toBe(0);
  });

  it('shares read results with Agent while preserving preview authorization and delegation', async () => {
    const app = service.create({ name: 'Read fixture', idea: 'Test capability reads' });
    const runtime = createProductDispatcher(undefined, { getLocalApps: () => service });
    const caller: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['gateway.admin'], authorize: () => true };
    expect(await runtime.call('xopc.local_apps.list', {}, caller)).toEqual({ apps: service.list() });
    const read = await runtime.call('xopc.local_apps.get', { id: app.id }, caller);
    expect(read).toEqual({ app: service.get(app.id) });
    const tool = createXopcUseTool({ getLocalAppService: () => service });
    expect((await tool.execute('read', { mode: 'local_app', command: 'get', args: { id: app.id } })).details.result).toEqual({ ok: true, ...read as object });
    await expect(runtime.call('xopc.local_apps.get', { id: app.id }, { ...caller, scopes: ['workspace.read'] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(runtime.call('xopc.local_apps.get', { id: app.id }, { ...caller, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(runtime.call('xopc.local_apps.get', { id: 'missing' }, caller)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(runtime.list({ ...caller, allowedCapabilities: [] })).toEqual([]);
    expect(service.get(app.id)).toEqual(app);
  });

  it('validates through shared entry points without modifying files or durable state', async () => {
    const app = service.create({ name: 'Validation fixture', idea: 'Read only validation' });
    const dispatcher = createProductDispatcher(undefined, { getLocalApps: () => service });
    const caller: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['gateway.admin'], authorize: () => true };
    const manifestPath = join(app.workspaceRoot, 'xopc.extension.json');
    const manifest = readFileSync(manifestPath, 'utf8');
    const changes = getSqliteDatabase().prepare('SELECT total_changes() AS n').get()!.n;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(123456);
    try {
      const read = await dispatcher.call('xopc.local_apps.validate', { id: app.id }, caller);
      expect(read).toEqual({ validation: service.validate(app.id) });
      const tool = createXopcUseTool({ getLocalAppService: () => service });
      expect((await tool.execute('validate', { mode: 'local_app', command: 'validate', args: { id: app.id } })).details.result)
        .toEqual({ ok: true, app: service.get(app.id), ...read as object });
      expect(getSqliteDatabase().prepare('SELECT total_changes() AS n').get()!.n).toBe(changes);
      expect(readFileSync(manifestPath, 'utf8')).toBe(manifest);
      await expect(dispatcher.call('xopc.local_apps.validate', { id: app.id }, { ...caller, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally { clock.mockRestore(); }
  });

  it('creates a previewable UI-only app and a coder project', () => {
    const app = service.create({ name: 'Reading List', idea: 'Track articles and reading progress' });
    const project = projects.get(app.projectId);

    expect(app.status).toBe('preview_ready');
    expect(app.installationState).toBe('not_installed');
    expect(app.enabled).toBe(false);
    expect(app.releases).toEqual([]);
    expect(app.draftPreviewUrl).toMatch(/^\/api\/local-apps\/preview\/[A-Za-z0-9_-]+\/draft\/ui\/index\.html$/);
    expect(app.permissions).toEqual(['theme', 'storage']);
    expect(project).toMatchObject({ defaultAgentId: 'coder', workspaceRoot: app.workspaceRoot });
    expect(readFileSync(join(app.workspaceRoot, '.xopc', 'app.json'), 'utf8')).toContain(app.extensionId);
    expect(readFileSync(join(app.workspaceRoot, '.xopc', 'acceptance.json'), 'utf8')).toContain('start-app');
    expect(readFileSync(join(app.workspaceRoot, '.xopc', 'runtime', 'local-ui.js'), 'utf8'))
      .toBe('export default Object.freeze({});\n');
    expect(existsSync(join(app.workspaceRoot, 'ui', 'index.html'))).toBe(true);
    expect(events).toContain('local_app.created');
  });

  it('materializes content-addressed previews that do not change with the draft', () => {
    const app = service.create({ name: 'Snapshot Board', idea: 'Preserve historical previews' });
    const scriptPath = join(app.workspaceRoot, 'ui', 'app.js');
    const firstSource = readFileSync(scriptPath, 'utf8');

    const first = service.materializeSnapshot(app.id);
    writeFileSync(scriptPath, 'document.body.dataset.version = "two";');
    const second = service.materializeSnapshot(app.id);

    expect(first.status).toBe('ready');
    expect(first.sourceHash).not.toBe(second.sourceHash);
    expect(first.previewUrl).toContain(`/snapshots/${first.sourceHash}/ui/index.html`);
    expect(service.getSnapshot(app.id, first.sourceHash)).toEqual(first);
    expect(readFileSync(join(
      paths.root,
      'local-apps',
      'snapshots',
      app.id,
      first.sourceHash,
      'package',
      'ui',
      'app.js',
    ), 'utf8')).toBe(firstSource);
    expect(service.materializeSnapshot(app.id).sourceHash).toBe(second.sourceHash);
  });

  it('installs the current draft, enables it, and preserves its stable id', async () => {
    config = { extensions: { disabled: [] } } as unknown as Config;
    const created = service.create({ name: 'Focus Board', idea: 'A simple personal focus board' });
    await expect(service.install(created.id)).rejects.toThrow('has not passed automatic acceptance');
    const acceptance = acceptCurrentDraft(created.id);

    const installed = await service.install(created.id);

    expect(installed.status).toBe('installed');
    expect(installed.activeVersion).toBe(1);
    expect(installed.draftVersion).toBe(2);
    expect(installed.installationState).toBe('installed');
    expect(installed.enabled).toBe(true);
    expect(installed.acceptanceRuns).toEqual([expect.objectContaining({ id: acceptance.id, status: 'passed' })]);
    expect(installed.releases).toEqual([
      expect.objectContaining({ version: 1, healthStatus: 'healthy', isActive: true }),
    ]);
    expect((config.extensions as { enabled?: string[] }).enabled).toContain(created.extensionId);
    expect(existsSync(join(paths.root, 'extensions', created.extensionId, 'ui', 'index.html'))).toBe(true);
    expect(existsSync(join(paths.root, 'local-apps', 'releases', created.id, 'v1', 'ui', 'index.html'))).toBe(true);
    expect(events).toEqual(expect.arrayContaining(['config.reload', 'local_app.installed']));
  });

  it('rejects a stale capability contract before accepting or installing a release', async () => {
    const created = service.create({ name: 'Stale contract', idea: 'Do not activate obsolete bindings' });
    const path = join(created.workspaceRoot, 'xopc.extension.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.ui.capabilities = [{ id: 'xopc.notes.create', majorVersion: 1, descriptorDigest: '0'.repeat(64) }];
    writeFileSync(path, JSON.stringify(manifest));
    expect(service.validate(created.id).status).toBe('failed');
    await expect(service.install(created.id)).rejects.toThrow('Capability contract changed');
    expect(service.get(created.id)?.installationState).toBe('not_installed');
  });

  it('rejects tampered rollback artifacts without changing the active release', async () => {
    const created = service.create({ name: 'Tampered artifact', idea: 'Keep the active release safe' });
    acceptCurrentDraft(created.id);
    const first = await service.install(created.id);
    const script = join(created.workspaceRoot, 'ui', 'app.js');
    writeFileSync(script, readFileSync(script, 'utf8') + '\n// version 2\n');
    acceptCurrentDraft(created.id);
    const second = await service.install(created.id);
    const oldArtifact = join(paths.root, 'local-apps', 'releases', created.id, 'v1', 'ui', 'app.js');
    writeFileSync(oldArtifact, 'document.body.dataset.tampered = "true";');
    await expect(service.rollback(created.id, first.activeReleaseId!)).rejects.toThrow('integrity check failed');
    expect(service.get(created.id)?.activeReleaseId).toBe(second.activeReleaseId);
  });

  it('retains immutable releases and rolls back without changing the draft', async () => {
    const created = service.create({ name: 'Release Board', idea: 'Track release safety' });
    const appScript = join(created.workspaceRoot, 'ui', 'app.js');
    const firstSource = readFileSync(appScript, 'utf8');
    acceptCurrentDraft(created.id);
    const first = await service.install(created.id);
    writeFileSync(appScript, 'document.body.dataset.version = "two";');
    acceptCurrentDraft(created.id);
    const second = await service.install(created.id);
    const firstRelease = second.releases.find((release) => release.version === 1)!;

    const rolledBack = await service.rollback(created.id, firstRelease.id);

    expect(first.activeVersion).toBe(1);
    expect(second.activeVersion).toBe(2);
    expect(rolledBack.activeVersion).toBe(1);
    expect(rolledBack.draftVersion).toBe(3);
    expect(readFileSync(join(paths.root, 'extensions', created.extensionId, 'ui', 'app.js'), 'utf8')).toBe(firstSource);
    expect(rolledBack.releases).toHaveLength(2);
    expect(events).toContain('local_app.rolled_back');
  });

  it('reports draft changes against the active release', async () => {
    const created = service.create({ name: 'Draft Checks', idea: 'Show safe draft feedback' });
    const beforeInstall = service.validate(created.id);
    expect(beforeInstall).toMatchObject({ status: 'healthy', hasDraftChanges: true });
    expect(beforeInstall.changedFileCount).toBeGreaterThan(0);

    acceptCurrentDraft(created.id);
    await service.install(created.id);
    expect(service.validate(created.id)).toMatchObject({
      status: 'healthy',
      hasDraftChanges: false,
      changedFileCount: 0,
    });

    writeFileSync(join(created.workspaceRoot, 'ui', 'app.js'), 'document.body.dataset.changed = "true";');
    const changed = service.validate(created.id);
    expect(changed).toMatchObject({ status: 'healthy', hasDraftChanges: true });
    expect(changed.changedFiles).toContainEqual({ path: 'ui/app.js', status: 'modified' });
  });

  it('rejects stale acceptance results after the draft changes', () => {
    const created = service.create({ name: 'Stale Check', idea: 'Bind acceptance to source' });
    const validation = service.validate(created.id);
    writeFileSync(join(created.workspaceRoot, 'ui', 'app.js'), 'document.body.dataset.changed = "true";');

    expect(() => service.recordAcceptance(created.id, {
      sourceHash: validation.sourceHash!,
      status: 'passed',
      interactiveCount: 0,
      checks: [
        { id: 'document', status: 'passed', message: 'Preview document loaded' },
        { id: 'content', status: 'passed', message: 'Visible content rendered' },
        { id: 'interaction', status: 'skipped', message: 'No interactive controls to exercise' },
      ],
    })).toThrow('draft changed');
  });

  it('validates product scenarios and requires their result before install', () => {
    const created = service.create({ name: 'Scenario Gate', idea: 'Protect a critical journey' });
    const validation = service.validate(created.id);

    expect(validation).toMatchObject({
      status: 'healthy',
      acceptanceScenarioCount: 1,
      acceptanceScenarios: [{ id: 'start-app', name: 'Start the app', stepCount: 2 }],
    });
    expect(() => service.recordAcceptance(created.id, {
      sourceHash: validation.sourceHash!,
      status: 'passed',
      interactiveCount: 1,
      checks: [
        { id: 'document', status: 'passed', message: 'Preview document loaded' },
        { id: 'content', status: 'passed', message: 'Visible content rendered' },
        { id: 'interaction', status: 'passed', message: 'One control is discoverable' },
      ],
    })).toThrow('every required check');
  });

  it('rejects unsafe acceptance targets during static validation', () => {
    const created = service.create({ name: 'Safe Criteria', idea: 'Keep automation declarative' });
    writeFileSync(join(created.workspaceRoot, '.xopc', 'acceptance.json'), JSON.stringify({
      schemaVersion: 1,
      scenarios: [{
        id: 'unsafe',
        name: 'Unsafe selector',
        steps: [{ action: 'click', target: 'button:first-child' }],
      }],
    }));

    expect(service.validate(created.id)).toMatchObject({
      status: 'failed',
      acceptanceScenarioCount: 0,
      issues: [expect.objectContaining({ code: 'package_validation_failed' })],
    });
  });

  it('reports permission additions and removals for install review', async () => {
    const created = service.create({ name: 'Permission Delta', idea: 'Review capability changes' });
    acceptCurrentDraft(created.id);
    await service.install(created.id);
    const manifestPath = join(created.workspaceRoot, 'xopc.extension.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { ui: { permissions: string[] } };
    manifest.ui.permissions = ['theme', 'notification'];
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = service.validate(created.id);

    expect(result.status).toBe('healthy');
    expect(result.permissionDelta).toEqual({ added: ['notification'], removed: ['storage'] });
  });

  it('stores UI grants authoritatively and invalidates them when the release manifest changes', async () => {
    const created = service.create({ name: 'Grant Boundary', idea: 'Bind permissions to the installed release' });
    acceptCurrentDraft(created.id);
    const first = await service.install(created.id);

    expect(service.getUiGrant(created.extensionId)).toMatchObject({
      granted: false,
      extensionId: created.extensionId,
      appId: created.id,
      permissions: ['storage', 'theme'],
    });
    const granted = service.grantUiPermissions(created.extensionId, service.getUiGrant(created.extensionId).manifestDigest!);
    expect(granted).toMatchObject({ granted: true, extensionId: created.extensionId, appId: created.id });
    expect(service.getUiGrant(created.extensionId)).toMatchObject({
      granted: true,
      manifestDigest: granted.manifestDigest,
    });

    const manifestPath = join(created.workspaceRoot, 'xopc.extension.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version: string;
      ui: { permissions: string[] };
    };
    manifest.version = '0.1.1';
    manifest.ui.permissions.push('notification');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    acceptCurrentDraft(created.id);
    const second = await service.install(created.id);

    expect(second.activeVersion).toBe(first.activeVersion! + 1);
    expect(service.getUiGrant(created.extensionId)).toMatchObject({
      granted: false,
      extensionId: created.extensionId,
      permissions: ['notification', 'storage', 'theme'],
    });
  });

  it('invalidates grants on UI-only release changes and rejects stale confirmation', async () => {
    const created = service.create({ name: 'UI version grant', idea: 'Authorize exact installed code' });
    acceptCurrentDraft(created.id);
    await service.install(created.id);
    const first = service.getUiGrant(created.extensionId).manifestDigest!;
    service.grantUiPermissions(created.extensionId, first);
    const script = join(created.workspaceRoot, 'ui', 'app.js');
    writeFileSync(script, readFileSync(script, 'utf8') + '\n// Revised UI release\n');
    acceptCurrentDraft(created.id);
    await service.install(created.id);
    const next = service.getUiGrant(created.extensionId);
    expect(next.granted).toBe(false);
    expect(next.manifestDigest).not.toBe(first);
    expect(() => service.grantUiPermissions(created.extensionId, first)).toThrow('release changed');
    expect(service.grantUiPermissions(created.extensionId, next.manifestDigest!).granted).toBe(true);
  });

  it('binds capability access to the enabled installed release and reviewed permissions', async () => {
    const created = service.create({ name: 'Capability binding', idea: 'Read explicitly granted notes' });
    const manifestPath = join(created.workspaceRoot, 'xopc.extension.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const descriptor = createProductDispatcher().describe('xopc.notes.list', { principalId: 'test', surface: 'extension', scopes: ['workspace.read'], authorize: () => true });
    const binding = { id: descriptor.id, majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest };
    manifest.ui.capabilities = [binding];
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(service.validate(created.id).permissionDelta.added).toContain('capability:xopc.notes.list');
    expect(service.get(created.id)?.permissions).toContain('capability:xopc.notes.list');
    expect(() => service.getCapabilityAccess(created.extensionId, 'a'.repeat(64))).toThrow('not enabled and installed');
    acceptCurrentDraft(created.id);
    await service.install(created.id);
    const grant = service.getUiGrant(created.extensionId);
    expect(grant.permissions).toContain('capability:xopc.notes.list');
    expect(() => service.getCapabilityAccess(created.extensionId, grant.manifestDigest!)).toThrow('not been granted');
    service.grantUiPermissions(created.extensionId, grant.manifestDigest!);
    expect(service.getCapabilityAccess(created.extensionId, grant.manifestDigest!).bindings).toEqual([binding]);
    expect(() => service.getCapabilityAccess(created.extensionId, '0'.repeat(64))).toThrow('release changed');
    await service.setEnabled(created.id, false);
    expect(() => service.getCapabilityAccess(created.extensionId, grant.manifestDigest!)).toThrow('not enabled and installed');
  });

  it('stores ordinary extension UI grants in the same authoritative store', () => {
    const extensionId = 'third-party-extension';
    const extensionRoot = join(paths.root, 'extensions', extensionId);
    mkdirSync(join(extensionRoot, 'ui'), { recursive: true });
    writeFileSync(join(extensionRoot, 'index.js'), 'export default {};\n');
    writeFileSync(join(extensionRoot, 'ui', 'index.html'), '<!doctype html>');
    writeFileSync(join(extensionRoot, 'xopc.extension.json'), JSON.stringify({
      id: extensionId,
      name: 'Third Party',
      version: '1.0.0',
      kind: 'utility',
      main: 'index.js',
      ui: { main: 'ui/index.html', permissions: ['theme'] },
      engines: { xopc: '>=0.0.0' },
    }));

    expect(service.getUiGrant(extensionId)).toMatchObject({
      extensionId,
      granted: false,
      permissions: ['theme'],
    });
    expect(service.grantUiPermissions(extensionId, service.getUiGrant(extensionId).manifestDigest!)).toMatchObject({
      extensionId,
      granted: true,
      permissions: ['theme'],
    });
  });

  it('keeps the active release available when a draft fails validation', async () => {
    const created = service.create({ name: 'Safe Update', idea: 'Never break the active release' });
    acceptCurrentDraft(created.id);
    const installed = await service.install(created.id);
    const targetScript = join(paths.root, 'extensions', created.extensionId, 'ui', 'app.js');
    const activeSource = readFileSync(targetScript, 'utf8');
    const manifestPath = join(created.workspaceRoot, 'xopc.extension.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { ui: { permissions: string[] } };
    manifest.ui.permissions.push('agent.send');
    writeFileSync(manifestPath, JSON.stringify(manifest));

    expect(service.validate(created.id)).toMatchObject({
      status: 'failed',
      issues: [expect.objectContaining({ code: 'package_validation_failed', severity: 'error' })],
    });

    await expect(service.install(created.id)).rejects.toThrow('cannot request');

    expect(service.get(created.id)?.activeVersion).toBe(installed.activeVersion);
    expect(readFileSync(targetScript, 'utf8')).toBe(activeSource);
  });

  it('rejects changes to the host-owned Node runtime entry', async () => {
    const created = service.create({ name: 'Runtime Boundary', idea: 'Keep generated code in the iframe' });
    const runtimeEntry = join(created.workspaceRoot, '.xopc', 'runtime', 'local-ui.js');
    writeFileSync(runtimeEntry, 'import "node:fs"; export default {};\n');

    expect(service.validate(created.id)).toMatchObject({
      status: 'failed',
      issues: [expect.objectContaining({ code: 'package_validation_failed' })],
    });
    await expect(service.install(created.id)).rejects.toThrow('xopc-owned runtime entry');
    expect(existsSync(join(paths.root, 'extensions', created.extensionId))).toBe(false);
  });

  it('rejects obsolete runtime entry points without rewriting the draft', () => {
    const app = service.create({ name: 'Current runtime only', idea: 'No compatibility entry' });
    const manifestPath = join(app.workspaceRoot, 'xopc.extension.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.main = 'index.js';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(join(app.workspaceRoot, 'index.js'), 'export default Object.freeze({});\n');
    expect(service.validate(app.id)).toMatchObject({ status: 'failed', issues: [expect.objectContaining({ message: expect.stringContaining('xopc-owned runtime entry') })] });
    expect(JSON.parse(readFileSync(manifestPath, 'utf8')).main).toBe('index.js');
  });

  it('rolls activation back when the installed extension cannot be discovered', async () => {
    const created = service.create({ name: 'Runtime Probe', idea: 'Verify the installed path before commit' });
    acceptCurrentDraft(created.id);
    vi.spyOn(extensionLoader, 'discoverExtensions').mockReturnValue([]);

    await expect(service.install(created.id)).rejects.toThrow('not discovered');

    expect(service.get(created.id)?.installationState).toBe('not_installed');
    expect(existsSync(join(paths.root, 'extensions', created.extensionId))).toBe(false);
    expect((config.extensions as { enabled?: string[] }).enabled ?? []).not.toContain(created.extensionId);
  });

  it('disables, re-enables, and uninstalls without deleting the Project or releases', async () => {
    const created = service.create({ name: 'Lifecycle App', idea: 'Exercise app lifecycle controls' });
    acceptCurrentDraft(created.id);
    await service.install(created.id);

    const disabled = await service.setEnabled(created.id, false);
    expect(disabled.enabled).toBe(false);
    expect((config.extensions as { disabled?: string[] }).disabled).toContain(created.extensionId);

    const enabled = await service.setEnabled(created.id, true);
    expect(enabled.enabled).toBe(true);

    const uninstalled = await service.uninstall(created.id);
    expect(uninstalled.installationState).toBe('not_installed');
    expect(uninstalled.releases).toHaveLength(1);
    expect(projects.get(created.projectId)).not.toBeNull();
    expect(existsSync(join(paths.root, 'extensions', created.extensionId))).toBe(false);
    expect(events).toEqual(expect.arrayContaining(['local_app.disabled', 'local_app.enabled', 'local_app.uninstalled']));
  });
});
