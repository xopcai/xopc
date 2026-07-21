import { createHash, randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

import { resolveExtensionsDir, resolveStateDir } from '../config/paths.js';
import type { Config } from '../config/schema.js';
import type { ExtensionLoader } from '../extensions/index.js';
import type { ProjectService } from '../projects/index.js';
import { slugifyProjectName } from '../projects/project-store.js';
import { createLogger } from '../utils/logger.js';
import { readLocalAppAcceptanceConfig } from './acceptance.js';
import {
  legacyLocalAppRuntimeSource,
  LOCAL_APP_RUNTIME_ENTRY,
  LOCAL_APP_RUNTIME_SOURCE,
} from './runtime-entry.js';
import { readLocalAppPermissions, scaffoldLocalApp } from './scaffold.js';
import { LocalAppStore } from './store.js';
import type {
  CreateLocalAppInput,
  LocalAppChangedFile,
  LocalApp,
  LocalAppAcceptanceRun,
  LocalAppDetail,
  LocalAppPreviewTarget,
  LocalAppValidationResult,
  LocalAppUiGrant,
  RecordLocalAppAcceptanceInput,
} from './types.js';

const log = createLogger('LocalApps');
const RELEASE_COPY_EXCLUDED_NAMES = new Set(['.git', 'node_modules']);
const UI_ONLY_PERMISSIONS = new Set(['theme', 'storage', 'notification']);

export interface LocalAppServiceOptions {
  projects: ProjectService;
  workspaceRoot: string;
  getConfig: () => Config;
  saveConfig: (config: Config) => Promise<{ saved: boolean; error?: string }>;
  getExtensionLoader: () => ExtensionLoader | null;
  emit: (type: string, payload: unknown) => void;
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

function extensionConfigRecord(config: Config): Record<string, unknown> {
  return config.extensions && typeof config.extensions === 'object' && !Array.isArray(config.extensions)
    ? { ...(config.extensions as Record<string, unknown>) }
    : {};
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function setExtensionActivation(config: Config, extensionId: string, enabled: boolean): Config {
  const extensions = extensionConfigRecord(config);
  const enabledIds = stringIds(extensions.enabled).filter((id) => id !== extensionId);
  const disabledIds = stringIds(extensions.disabled).filter((id) => id !== extensionId);
  if (enabled) enabledIds.push(extensionId);
  else disabledIds.push(extensionId);
  const nextExtensions: Record<string, unknown> = { ...extensions, enabled: enabledIds };
  if (disabledIds.length) nextExtensions.disabled = disabledIds;
  else delete nextExtensions.disabled;
  return { ...config, extensions: nextExtensions } as Config;
}

function removeExtensionActivation(config: Config, extensionId: string): Config {
  const extensions = extensionConfigRecord(config);
  return {
    ...config,
    extensions: {
      ...extensions,
      enabled: stringIds(extensions.enabled).filter((id) => id !== extensionId),
      disabled: stringIds(extensions.disabled).filter((id) => id !== extensionId),
    },
  } as Config;
}

function shouldCopyReleasePath(source: string): boolean {
  return !RELEASE_COPY_EXCLUDED_NAMES.has(basename(source));
}

function hashDirectory(root: string): string {
  const hash = createHash('sha256');
  const visit = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !RELEASE_COPY_EXCLUDED_NAMES.has(entry.name))
      .toSorted((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const rel = relative(root, path);
      hash.update(rel);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) hash.update(readFileSync(path));
      else throw new Error(`Unsupported release entry: ${rel}`);
    }
  };
  visit(root);
  return hash.digest('hex');
}

function fileHashes(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const visit = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !RELEASE_COPY_EXCLUDED_NAMES.has(entry.name))
      .toSorted((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const rel = relative(root, path);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) hashes.set(rel, createHash('sha256').update(readFileSync(path)).digest('hex'));
      else throw new Error(`Unsupported release entry: ${rel}`);
    }
  };
  visit(root);
  return hashes;
}

function changedFiles(current: Map<string, string>, active: Map<string, string>): LocalAppChangedFile[] {
  const paths = new Set([...current.keys(), ...active.keys()]);
  const changes: LocalAppChangedFile[] = [];
  for (const path of [...paths].toSorted()) {
    const currentHash = current.get(path);
    const activeHash = active.get(path);
    if (!activeHash) changes.push({ path, status: 'added' });
    else if (!currentHash) changes.push({ path, status: 'deleted' });
    else if (currentHash !== activeHash) changes.push({ path, status: 'modified' });
  }
  return changes;
}

function permissionsFromManifestJson(manifestJson: string | undefined): string[] {
  if (!manifestJson) return [];
  try {
    const manifest = JSON.parse(manifestJson) as { ui?: { permissions?: unknown } };
    return Array.isArray(manifest.ui?.permissions)
      ? manifest.ui.permissions.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function validateLocalAppPackage(root: string, extensionId: string): {
  manifestJson: string;
  acceptanceScenarios: Array<{ id: string; name: string; stepCount: number }>;
} {
  const manifestPath = join(root, 'xopc.extension.json');
  if (!existsSync(manifestPath)) throw new Error('Local app manifest is missing');
  const manifestJson = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestJson) as {
    id?: string;
    name?: string;
    main?: string;
    ui?: { main?: string; permissions?: unknown };
  };
  if (manifest.id !== extensionId) throw new Error('Extension id cannot change after the app is created');
  if (!manifest.main || !manifest.ui?.main) throw new Error('Local app manifest must declare main and ui.main');
  const resolvedRoot = resolve(root);
  for (const declaredPath of [manifest.main, manifest.ui.main]) {
    const resolvedPath = resolve(root, declaredPath);
    if (!resolvedPath.startsWith(`${resolvedRoot}${sep}`) || !existsSync(resolvedPath) || !lstatSync(resolvedPath).isFile()) {
      throw new Error(`Declared app file is missing or unsafe: ${declaredPath}`);
    }
  }
  const trustedRuntime = manifest.main === LOCAL_APP_RUNTIME_ENTRY
    ? LOCAL_APP_RUNTIME_SOURCE
    : manifest.main === 'index.js' && typeof manifest.name === 'string'
      ? legacyLocalAppRuntimeSource(extensionId, manifest.name)
      : null;
  if (trustedRuntime === null || readFileSync(join(root, manifest.main), 'utf8') !== trustedRuntime) {
    throw new Error(`Phase 1 local apps must use the xopc-owned runtime entry: ${LOCAL_APP_RUNTIME_ENTRY}`);
  }
  const permissions = Array.isArray(manifest.ui.permissions)
    ? manifest.ui.permissions.filter((value): value is string => typeof value === 'string')
    : [];
  const unsupported = permissions.filter((permission) => !UI_ONLY_PERMISSIONS.has(permission));
  if (unsupported.length) {
    throw new Error(`Phase 1 local apps cannot request: ${unsupported.join(', ')}`);
  }
  const html = readFileSync(join(root, manifest.ui.main), 'utf8');
  if (/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html)) {
    throw new Error('Inline scripts are blocked in local app previews');
  }
  if (/(?:src|href)\s*=\s*["']https?:\/\//i.test(html)) {
    throw new Error('Remote scripts, styles, and frames are blocked in Phase 1 local apps');
  }
  const acceptance = readLocalAppAcceptanceConfig(root);
  return {
    manifestJson,
    acceptanceScenarios: acceptance.scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      stepCount: scenario.steps.length,
    })),
  };
}

export class LocalAppService {
  constructor(
    private readonly options: LocalAppServiceOptions,
    private readonly store = new LocalAppStore(),
  ) {}

  list(): LocalApp[] {
    return this.store.list();
  }

  get(id: string): LocalAppDetail | null {
    const app = this.store.get(id);
    const token = app ? this.store.getPreviewToken(id) : null;
    if (!app || !token) return null;
    return {
      ...app,
      previewUrl: `/api/local-apps/preview/${token}/ui/index.html`,
      permissions: readLocalAppPermissions(app.workspaceRoot),
      releases: this.store.listReleases(id).map(({ artifactPath: _artifactPath, manifestJson: _manifestJson, ...release }) => release),
      acceptanceRuns: this.store.listAcceptanceRuns(id),
    };
  }

  getUiGrant(extensionId: string): LocalAppUiGrant {
    const app = this.store.findByExtensionId(extensionId);
    const release = app?.activeReleaseId ? this.store.getRelease(app.id, app.activeReleaseId) : null;
    const discovered = !release
      ? this.options.getExtensionLoader()?.discoverExtensions().find((extension) => extension.id === extensionId)
      : null;
    if (!release && !discovered) throw new Error('Extension UI manifest not found');
    const manifestJson = release?.manifestJson ?? JSON.stringify(discovered!.manifest);
    const manifestDigest = createHash('sha256').update(manifestJson).digest('hex');
    const permissions = release
      ? permissionsFromManifestJson(manifestJson).toSorted()
      : [...(discovered!.manifest.ui?.permissions ?? [])].toSorted();
    const grant = this.store.getUiGrant(extensionId, manifestDigest);
    const granted = Boolean(grant
      && JSON.stringify(grant.permissions.toSorted()) === JSON.stringify(permissions));
    return {
      granted,
      extensionId,
      appId: app?.id,
      manifestDigest,
      permissions,
      grantedAt: granted ? grant?.grantedAt : undefined,
    };
  }

  grantUiPermissions(extensionId: string): LocalAppUiGrant {
    const current = this.getUiGrant(extensionId);
    if (!current.manifestDigest) throw new Error('Extension UI manifest not found');
    return this.store.saveUiGrant({
      extensionId,
      appId: current.appId,
      manifestDigest: current.manifestDigest,
      permissions: current.permissions,
    });
  }

  create(input: CreateLocalAppInput): LocalAppDetail {
    const name = requireText(input.name, 'App name');
    const idea = requireText(input.idea, 'App idea');
    const suffix = randomBytes(4).toString('hex');
    const slug = slugifyProjectName(name).slice(0, 48);
    const extensionId = `local-${slug}-${suffix}`;
    const workspaceRoot = join(this.options.workspaceRoot, 'local-apps', extensionId);
    const previewToken = randomBytes(24).toString('base64url');

    mkdirSync(workspaceRoot, { recursive: true });
    scaffoldLocalApp({
      workspaceRoot,
      extensionId,
      name,
      idea,
      description: input.description?.trim() || undefined,
    });
    const project = this.options.projects.create({
      name,
      slug: extensionId,
      description: input.description?.trim() || `Local app: ${idea}`,
      brief: idea,
      instructions: 'Use the $build-xopc-local-app skill. Preserve the extension id and validate the app before each install.',
      defaultAgentId: 'coder',
      workspaceRoot,
      projectKind: 'coding',
    });
    const app = this.store.create({
      extensionId,
      projectId: project.id,
      name,
      description: input.description?.trim() || undefined,
      idea,
      workspaceRoot: project.workspaceRoot ?? workspaceRoot,
      previewToken,
    });
    this.options.emit('local_app.created', { appId: app.id, projectId: project.id });
    return this.get(app.id)!;
  }

  resolvePreview(previewToken: string): LocalAppPreviewTarget | null {
    const app = this.store.findByPreviewToken(previewToken);
    if (!app) return null;
    return { app, previewToken, uiRoot: app.workspaceRoot };
  }

  validate(id: string): LocalAppValidationResult {
    const app = this.store.get(id);
    if (!app) throw new Error('Local app not found');
    const issues: LocalAppValidationResult['issues'] = [];
    let manifestJson: string | undefined;
    let acceptanceScenarios: LocalAppValidationResult['acceptanceScenarios'] = [];
    let sourceHash: string | undefined;
    let currentFiles = new Map<string, string>();
    try {
      ({ manifestJson, acceptanceScenarios } = validateLocalAppPackage(app.workspaceRoot, app.extensionId));
      currentFiles = fileHashes(app.workspaceRoot);
      sourceHash = hashDirectory(app.workspaceRoot);
    } catch (error) {
      issues.push({
        code: 'package_validation_failed',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const activeRelease = app.activeReleaseId
      ? this.store.getRelease(app.id, app.activeReleaseId)
      : null;
    let files: LocalAppChangedFile[] = [];
    if (activeRelease?.artifactPath && existsSync(activeRelease.artifactPath) && currentFiles.size) {
      try {
        files = changedFiles(currentFiles, fileHashes(activeRelease.artifactPath));
      } catch (error) {
        issues.push({
          code: 'release_comparison_failed',
          severity: 'warning',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (!activeRelease && currentFiles.size) {
      files = [...currentFiles.keys()].toSorted().map((path) => ({ path, status: 'added' }));
    }

    const permissions = permissionsFromManifestJson(manifestJson);
    const activePermissions = permissionsFromManifestJson(activeRelease?.manifestJson);
    return {
      status: issues.some((issue) => issue.severity === 'error') ? 'failed' : 'healthy',
      checkedAt: Date.now(),
      sourceHash,
      hasDraftChanges: activeRelease ? sourceHash !== activeRelease.sourceHash : true,
      changedFiles: files.slice(0, 50),
      changedFileCount: files.length,
      permissions,
      permissionDelta: {
        added: permissions.filter((permission) => !activePermissions.includes(permission)),
        removed: activePermissions.filter((permission) => !permissions.includes(permission)),
      },
      acceptanceScenarioCount: acceptanceScenarios.length,
      acceptanceScenarios,
      issues,
    };
  }

  recordAcceptance(id: string, input: RecordLocalAppAcceptanceInput): LocalAppAcceptanceRun {
    const app = this.store.get(id);
    if (!app) throw new Error('Local app not found');
    const validation = this.validate(id);
    if (validation.status !== 'healthy' || !validation.sourceHash) {
      throw new Error('The current draft must pass static validation before acceptance can be recorded');
    }
    if (input.sourceHash !== validation.sourceHash) {
      throw new Error('Acceptance result is stale because the draft changed');
    }
    if (input.status !== 'passed' && input.status !== 'failed') {
      throw new Error('Invalid acceptance status');
    }
    if (!Number.isInteger(input.interactiveCount) || input.interactiveCount < 0 || input.interactiveCount > 10_000) {
      throw new Error('Invalid acceptance interactive count');
    }
    const requiredIds = new Set(['document', 'content', 'interaction']);
    if (validation.acceptanceScenarioCount > 0) requiredIds.add('criteria');
    const allowedIds = new Set([...requiredIds, 'criteria']);
    const allowedStatuses = new Set(['passed', 'failed', 'skipped']);
    if (!Array.isArray(input.checks)
      || input.checks.length < requiredIds.size
      || input.checks.length > allowedIds.size) {
      throw new Error('Automatic acceptance must include every required check');
    }
    const seenIds = new Set<string>();
    for (const check of input.checks) {
      if (!allowedIds.has(check.id) || seenIds.has(check.id)) throw new Error('Invalid automatic acceptance check');
      if (!allowedStatuses.has(check.status)) throw new Error('Invalid automatic acceptance check status');
      if (typeof check.message !== 'string' || !check.message.trim() || check.message.length > 500) {
        throw new Error('Invalid automatic acceptance check message');
      }
      seenIds.add(check.id);
    }
    if ([...requiredIds].some((checkId) => !seenIds.has(checkId))) {
      throw new Error('Automatic acceptance must include every required check');
    }
    const derivedStatus = input.checks.some((check) => check.status === 'failed') ? 'failed' : 'passed';
    if (derivedStatus !== input.status) throw new Error('Acceptance status does not match its checks');
    const run = this.store.recordAcceptance(app.id, input);
    this.options.emit('local_app.acceptance_recorded', {
      appId: app.id,
      sourceHash: run.sourceHash,
      status: run.status,
    });
    return run;
  }

  private releaseRoot(appId: string): string {
    return join(resolveStateDir(), 'local-apps', 'releases', appId);
  }

  private refreshExtensions(source: string): void {
    this.options.getExtensionLoader()?.invalidateManifestCache();
    this.options.emit('config.reload', { section: 'extensions', source });
  }

  private assertInstalledRuntime(app: LocalApp, target: string): void {
    const loader = this.options.getExtensionLoader();
    if (!loader) return;
    loader.invalidateManifestCache();
    const installed = loader.discoverExtensions().find((extension) => extension.id === app.extensionId);
    if (!installed || resolve(installed.path) !== resolve(target) || !installed.manifest.ui?.main) {
      throw new Error('Installed local app was not discovered by the extension runtime');
    }
    const extensionRoot = resolve(installed.path);
    const entrypoint = resolve(extensionRoot, installed.manifest.ui.main);
    if (!entrypoint.startsWith(`${extensionRoot}${sep}`) || !existsSync(entrypoint)) {
      throw new Error('Installed local app UI entrypoint is unavailable');
    }
    loader.buildManifestRegistry();
  }

  private async activateArtifact(input: {
    app: LocalApp;
    artifactPath: string;
    nextConfig: Config;
    source: string;
    commit: () => void;
  }): Promise<void> {
    const previousConfig = this.options.getConfig();
    const extensionsDir = resolveExtensionsDir();
    mkdirSync(extensionsDir, { recursive: true });
    const transactionRoot = mkdtempSync(join(extensionsDir, '.local-app-activate-'));
    const staged = join(transactionRoot, input.app.extensionId);
    const backup = join(transactionRoot, 'previous');
    const target = join(extensionsDir, input.app.extensionId);
    cpSync(input.artifactPath, staged, { recursive: true, filter: shouldCopyReleasePath });
    let hadPrevious = false;
    let configSaved = false;
    try {
      if (existsSync(target)) {
        renameSync(target, backup);
        hadPrevious = true;
      }
      renameSync(staged, target);
      validateLocalAppPackage(target, input.app.extensionId);
      const saved = await this.options.saveConfig(input.nextConfig);
      if (!saved.saved) throw new Error(saved.error ?? 'Failed to update local app activation');
      configSaved = true;
      this.refreshExtensions(input.source);
      this.assertInstalledRuntime(input.app, target);
      input.commit();
    } catch (error) {
      if (existsSync(target)) rmSync(target, { recursive: true, force: true });
      if (hadPrevious && existsSync(backup)) renameSync(backup, target);
      if (configSaved) {
        const restored = await this.options.saveConfig(previousConfig);
        if (!restored.saved) {
          log.error({ appId: input.app.id, error: restored.error }, 'Local app config rollback failed');
        }
      }
      this.refreshExtensions(`${input.source}-rollback`);
      throw error;
    } finally {
      rmSync(transactionRoot, { recursive: true, force: true });
    }
  }

  async install(id: string): Promise<LocalAppDetail> {
    const app = this.store.get(id);
    if (!app) throw new Error('Local app not found');
    const releaseRoot = this.releaseRoot(app.id);
    mkdirSync(releaseRoot, { recursive: true });
    const artifactPath = join(releaseRoot, `v${app.draftVersion}`);
    if (existsSync(artifactPath)) throw new Error(`Release v${app.draftVersion} already exists`);
    const stagingRoot = mkdtempSync(join(releaseRoot, '.draft-'));
    const stagedArtifact = join(stagingRoot, 'package');
    let artifactCreated = false;
    try {
      cpSync(app.workspaceRoot, stagedArtifact, { recursive: true, filter: shouldCopyReleasePath });
      const { manifestJson } = validateLocalAppPackage(stagedArtifact, app.extensionId);
      const sourceHash = hashDirectory(stagedArtifact);
      const acceptance = this.store.getLatestAcceptanceForSource(app.id, sourceHash);
      if (acceptance?.status !== 'passed') {
        throw new Error('The current draft has not passed automatic acceptance');
      }
      renameSync(stagedArtifact, artifactPath);
      artifactCreated = true;
      await this.activateArtifact({
        app,
        artifactPath,
        nextConfig: setExtensionActivation(this.options.getConfig(), app.extensionId, true),
        source: 'local-app-install',
        commit: () => {
          this.store.markInstalled({
            id: app.id,
            version: app.draftVersion,
            sourceHash,
            artifactPath,
            manifestJson,
          });
        },
      });
    } catch (error) {
      if (artifactCreated) rmSync(artifactPath, { recursive: true, force: true });
      throw error;
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }

    const next = this.get(id)!;
    this.options.emit('local_app.installed', {
      appId: app.id,
      extensionId: app.extensionId,
      version: next.activeVersion,
    });
    log.info({ appId: app.id, extensionId: app.extensionId, version: next.activeVersion }, 'Local app installed');
    return next;
  }

  async rollback(id: string, releaseId: string): Promise<LocalAppDetail> {
    const app = this.store.get(id);
    if (!app) throw new Error('Local app not found');
    const release = this.store.getRelease(id, releaseId);
    if (!release || !release.artifactPath || !existsSync(release.artifactPath)) {
      throw new Error('Local app release artifact is unavailable');
    }
    validateLocalAppPackage(release.artifactPath, app.extensionId);
    await this.activateArtifact({
      app,
      artifactPath: release.artifactPath,
      nextConfig: setExtensionActivation(this.options.getConfig(), app.extensionId, true),
      source: 'local-app-rollback',
      commit: () => { this.store.activateRelease(id, releaseId); },
    });
    this.options.emit('local_app.rolled_back', { appId: id, releaseId, version: release.version });
    return this.get(id)!;
  }

  async setEnabled(id: string, enabled: boolean): Promise<LocalAppDetail> {
    const app = this.store.get(id);
    if (!app) throw new Error('Local app not found');
    if (app.installationState !== 'installed') throw new Error('Install the local app before changing its enabled state');
    const previousConfig = this.options.getConfig();
    const saved = await this.options.saveConfig(setExtensionActivation(previousConfig, app.extensionId, enabled));
    if (!saved.saved) throw new Error(saved.error ?? 'Failed to update local app state');
    try {
      this.store.setEnabled(id, enabled);
    } catch (error) {
      await this.options.saveConfig(previousConfig);
      throw error;
    }
    this.refreshExtensions(enabled ? 'local-app-enable' : 'local-app-disable');
    this.options.emit(enabled ? 'local_app.enabled' : 'local_app.disabled', { appId: id });
    return this.get(id)!;
  }

  async uninstall(id: string): Promise<LocalAppDetail> {
    const app = this.store.get(id);
    if (!app) throw new Error('Local app not found');
    const extensionsDir = resolveExtensionsDir();
    mkdirSync(extensionsDir, { recursive: true });
    const target = join(extensionsDir, app.extensionId);
    const transactionRoot = mkdtempSync(join(extensionsDir, '.local-app-uninstall-'));
    const backup = join(transactionRoot, app.extensionId);
    const previousConfig = this.options.getConfig();
    let moved = false;
    let configSaved = false;
    try {
      if (existsSync(target)) {
        renameSync(target, backup);
        moved = true;
      }
      const saved = await this.options.saveConfig(removeExtensionActivation(previousConfig, app.extensionId));
      if (!saved.saved) throw new Error(saved.error ?? 'Failed to uninstall local app');
      configSaved = true;
      this.store.markUninstalled(id);
      this.refreshExtensions('local-app-uninstall');
    } catch (error) {
      if (moved && existsSync(backup)) renameSync(backup, target);
      if (configSaved) await this.options.saveConfig(previousConfig);
      throw error;
    } finally {
      rmSync(transactionRoot, { recursive: true, force: true });
    }
    this.options.emit('local_app.uninstalled', { appId: id, projectId: app.projectId });
    return this.get(id)!;
  }
}
