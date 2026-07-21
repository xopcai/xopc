import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('creates a previewable UI-only app and a coder project', () => {
    const app = service.create({ name: 'Reading List', idea: 'Track articles and reading progress' });
    const project = projects.get(app.projectId);

    expect(app.status).toBe('preview_ready');
    expect(app.installationState).toBe('not_installed');
    expect(app.enabled).toBe(false);
    expect(app.releases).toEqual([]);
    expect(app.previewUrl).toMatch(/^\/api\/local-apps\/preview\/[A-Za-z0-9_-]+\/ui\/index\.html$/);
    expect(app.permissions).toEqual(['theme', 'storage']);
    expect(project).toMatchObject({ defaultAgentId: 'coder', workspaceRoot: app.workspaceRoot });
    expect(readFileSync(join(app.workspaceRoot, '.xopc', 'app.json'), 'utf8')).toContain(app.extensionId);
    expect(readFileSync(join(app.workspaceRoot, '.xopc', 'acceptance.json'), 'utf8')).toContain('start-app');
    expect(readFileSync(join(app.workspaceRoot, '.xopc', 'runtime', 'local-ui.js'), 'utf8'))
      .toBe('export default Object.freeze({});\n');
    expect(existsSync(join(app.workspaceRoot, 'ui', 'index.html'))).toBe(true);
    expect(events).toContain('local_app.created');
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
    const granted = service.grantUiPermissions(created.extensionId);
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
    expect(service.grantUiPermissions(extensionId)).toMatchObject({
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
