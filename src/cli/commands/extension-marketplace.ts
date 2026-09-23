import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { confirm } from '@inquirer/prompts';
import { Command } from 'commander';
import semver from 'semver';

import {
  downloadExtensionStoreZipBuffer,
  resolveExtensionZipDownloadUrl,
  resolveExtensionsStoreBaseUrl,
  verifyStoreArtifactSha256,
} from '../../agent/skills/marketplace/adapters/store/store-api-client.js';
import { loadConfig } from '../../config/loader.js';
import { resolveExtensionsDir } from '../../config/paths.js';
import type { InstallResult } from '../../extensions/install.js';
import {
  peekExtensionManifestFromStoreZip,
} from '../../extensions/install.js';
import {
  commitStagedExtensionInstall,
  finalizeStagedExtensionInstall,
  rollbackStagedExtensionInstall,
  stageExtensionLocal,
  stageExtensionNpm,
  stageExtensionStoreZip,
  type StagedExtensionInstall,
} from '../../extensions/install-transaction.js';
import {
  computeExtensionDirectoryIntegrity,
  getExtensionLockfileManager,
} from '../../extensions/lockfile.js';
import * as marketplace from '../../extensions/marketplace.js';
import { colors } from '../utils/colors.js';
import { getContextWithOpts } from '../context.js';
import { validateExtensionPackageDirectory } from './extension-pack.js';
import { installAgentPluginFromCli, isAgentPluginSource } from './extension-agent-plugin.js';
import { AgentPluginStore } from '../../extensions/agent-plugins/store.js';
import { isAgentPluginArchive } from '../../extensions/agent-plugins/sources.js';

const MANIFEST = 'xopc.extension.json';

function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readInstalledSnapshots(targetDir: string, extensionId: string): {
  manifest?: Record<string, unknown>;
  packageJson?: Record<string, unknown>;
} {
  const root = join(targetDir, extensionId);
  return {
    manifest: readJsonObject(join(root, MANIFEST)),
    packageJson: readJsonObject(join(root, 'package.json')),
  };
}

function sha256Integrity(buffer: Buffer): string {
  return `sha256-${createHash('sha256').update(buffer).digest('base64')}`;
}

function printManifestSummary(params: {
  source: 'store' | 'npm' | 'local';
  packageName: string;
  version?: string;
  integrity?: string;
  manifest?: Record<string, unknown>;
}): void {
  const manifest = params.manifest;
  console.log('');
  console.log(colors.cyan('Extension install review'));
  console.log(`  Source: ${params.source}`);
  console.log(`  Package: ${params.packageName}${params.version ? `@${params.version}` : ''}`);
  if (params.integrity) console.log(`  Integrity: ${params.integrity}`);
  if (manifest) {
    console.log(`  ID: ${String(manifest.id ?? '(unknown)')}`);
    console.log(`  Name: ${String(manifest.name ?? manifest.id ?? '(unknown)')}`);
    const engines = manifest.engines as Record<string, unknown> | undefined;
    if (engines?.xopc) console.log(`  engines.xopc: ${String(engines.xopc)}`);
    const permissions = manifest.permissions as Record<string, unknown> | undefined;
    if (permissions) {
      console.log('  Permissions:');
      for (const [key, value] of Object.entries(permissions)) {
        console.log(`    ${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
      }
    }
    const contracts = manifest.contracts as Record<string, unknown> | undefined;
    if (contracts) {
      console.log('  Contracts:');
      for (const [key, value] of Object.entries(contracts)) {
        if (Array.isArray(value) && value.length > 0) console.log(`    ${key}: ${value.join(', ')}`);
      }
    }
  }
  console.log('');
}

async function confirmInstall(params: Parameters<typeof printManifestSummary>[0] & { yes?: boolean }): Promise<boolean> {
  printManifestSummary(params);
  if (params.yes || !process.stdin.isTTY) return true;
  return await confirm({ message: 'Install this extension?', default: false });
}

function parseNameAtVersion(raw: string): { name: string; version?: string } {
  const t = raw.trim();
  const at = t.lastIndexOf('@');
  if (at <= 0 || at === t.length - 1) return { name: t };
  const maybeVer = t.slice(at + 1);
  const v = semver.valid(maybeVer);
  if (v) return { name: t.slice(0, at), version: v };
  return { name: t };
}

function looksLikeLocalPath(raw: string): boolean {
  const p = raw.trim();
  if (p.startsWith('./') || p.startsWith('../')) return true;
  if (p === '.' || p === '..') return true;
  try {
    const abs = resolve(process.cwd(), p);
    return existsSync(abs) && statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/** xopc-store package names: lowercase letters, digits, hyphen (see xopc-store scan). */
const STORE_NAME_RE = /^[a-z0-9-]{1,64}$/;

async function upsertNpmExtensionLock(
  lock: ReturnType<typeof getExtensionLockfileManager>,
  targetDir: string,
  result: InstallResult,
  spec: string,
): Promise<void> {
  if (!result.extensionId) return;
  const reg = await marketplace.findExtension(result.extensionId);
  const resolved = reg?.npmPackage ?? spec;
  let ver = reg?.version ?? '0.0.0';
  try {
    const raw = readFileSync(join(targetDir, result.extensionId, MANIFEST), 'utf-8');
    const m = JSON.parse(raw) as { version?: string };
    const mv = typeof m.version === 'string' ? semver.valid(m.version) : null;
    if (mv) ver = mv;
  } catch {
    /* keep registry / fallback version */
  }
  await lock.upsert(result.extensionId, {
    name: result.extensionId,
    version: ver,
    resolved,
    source: 'npm',
    installedIntegrity: computeExtensionDirectoryIntegrity(join(targetDir, result.extensionId)),
    ...readInstalledSnapshots(targetDir, result.extensionId),
  });
}

async function commitStagedWithLock(
  transaction: StagedExtensionInstall,
  force: boolean,
  lock: ReturnType<typeof getExtensionLockfileManager>,
  writeLock: () => Promise<void>,
): Promise<void> {
  const lockSnapshot = await lock.load();
  let lockWriteStarted = false;
  try {
    commitStagedExtensionInstall(transaction, force);
    lockWriteStarted = true;
    await writeLock();
  } catch (error) {
    rollbackStagedExtensionInstall(transaction);
    if (lockWriteStarted) await lock.save(lockSnapshot);
    throw error;
  }
  finalizeStagedExtensionInstall(transaction);
}

async function installExtensionFromStoreWithLock(params: {
  storeBase: string;
  packageName: string;
  expectedExtensionId?: string;
  version?: string;
  targetDir: string;
  lock: ReturnType<typeof getExtensionLockfileManager>;
  force?: boolean;
  yes?: boolean;
}): Promise<{ ok: true; extensionId: string; version: string } | { ok: false; error: string }> {
  try {
    const { downloadUrl, version, sha256 } = await resolveExtensionZipDownloadUrl(
      params.storeBase,
      params.packageName,
      params.version,
    );
    console.log(
      colors.cyan('📦'),
      `Downloading ${params.packageName}@${version} from xopc-store (${params.storeBase})…`,
    );
    const buf = await downloadExtensionStoreZipBuffer(params.storeBase, downloadUrl);
    verifyStoreArtifactSha256(buf, sha256);
    if (isAgentPluginArchive(buf)) {
      const installed = await installAgentPluginFromCli(`store:${params.packageName}${params.version ? `@${params.version}` : ''}`, { yes: params.yes, force: params.force, expectedId: params.expectedExtensionId });
      if (!installed) return { ok: false, error: 'Install cancelled' };
      return { ok: true, extensionId: `plugin:${installed.id}`, version: installed.manifest.version ?? version };
    }
    const actualIntegrity = sha256Integrity(buf);
    const manifest = peekExtensionManifestFromStoreZip(buf);
    const accepted = await confirmInstall({
      source: 'store',
      packageName: params.packageName,
      version,
      integrity: actualIntegrity,
      manifest,
      yes: params.yes,
    });
    if (!accepted) {
      return { ok: false, error: 'Install cancelled' };
    }

    const transaction = await stageExtensionStoreZip(buf, params.targetDir);
    if (params.expectedExtensionId && transaction.extensionId !== params.expectedExtensionId) {
      rollbackStagedExtensionInstall(transaction);
      return {
        ok: false,
        error: `Expected extension ${params.expectedExtensionId}, received ${transaction.extensionId}`,
      };
    }
    const lockSnapshot = await params.lock.load();
    let lockWriteStarted = false;
    try {
      commitStagedExtensionInstall(transaction, params.force ?? false);
      lockWriteStarted = true;
      await params.lock.upsert(transaction.extensionId, {
        name: transaction.extensionId,
        version,
        resolved: params.packageName,
        source: 'store',
        artifactUrl: downloadUrl,
        integrity: actualIntegrity,
        installedIntegrity: computeExtensionDirectoryIntegrity(transaction.targetDir),
        ...readInstalledSnapshots(params.targetDir, transaction.extensionId),
      });
    } catch (err) {
      const rollbackErrors: string[] = [];
      try {
        rollbackStagedExtensionInstall(transaction);
      } catch (rollbackErr) {
        rollbackErrors.push(`files: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`);
      }
      if (lockWriteStarted) {
        try {
          await params.lock.save(lockSnapshot);
        } catch (rollbackErr) {
          rollbackErrors.push(`lockfile: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`);
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      const suffix = rollbackErrors.length > 0
        ? ` Rollback incomplete (${rollbackErrors.join('; ')}).`
        : '';
      throw new Error(`${message}${suffix}`, { cause: err });
    }

    try {
      finalizeStagedExtensionInstall(transaction);
    } catch (cleanupErr) {
      const message = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
      console.warn(colors.yellow('warning:'), `Installed extension, but temporary backup cleanup failed: ${message}`);
    }
    return { ok: true, extensionId: transaction.extensionId, version };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export function createExtensionInstallCommand(): Command {
  return new Command('install')
    .description(
      'Install a native extension or portable Agent Plugin from an explicit source',
    )
    .argument(
      '<target>',
      'store:<id>, npm:<package>, local directory, or Agent Plugin ZIP / HTTPS ZIP URL',
    )
    .option(
      '-f, --force',
      'Replace an existing store or local extension with the same manifest id',
      false,
    )
    .option('-y, --yes', 'Skip interactive install confirmation', false)
    .action(
      async (
        target: string,
        opts: { force: boolean; yes: boolean },
      ) => {
        if (isAgentPluginSource(target)) {
          await installAgentPluginFromCli(target, opts);
          return;
        }
        const ctx = getContextWithOpts();
        const cfg = loadConfig(ctx.configPath);
        const targetDir = resolveExtensionsDir();
        const lock = getExtensionLockfileManager();

        let installTarget = target.trim();
        const storeExplicit = /^store:/i.test(installTarget);
        const npmExplicit = /^npm:/i.test(installTarget);
        if (storeExplicit) {
          installTarget = installTarget.replace(/^store:/i, '').trim();
        } else if (npmExplicit) {
          installTarget = installTarget.replace(/^npm:/i, '').trim();
        }
        if (!installTarget) {
          console.error(colors.red('error:'), 'Missing target');
          process.exit(1);
        }

        const storeBase = resolveExtensionsStoreBaseUrl(cfg);

        if (storeExplicit) {
          const { name: pkgName, version: ver } = parseNameAtVersion(installTarget);
          if (!STORE_NAME_RE.test(pkgName)) {
            console.error(
              colors.red('error:'),
              'Invalid store package name (lowercase letters, digits, hyphen only)',
            );
            process.exit(1);
          }
          const r = await installExtensionFromStoreWithLock({
            storeBase,
            packageName: pkgName,
            version: ver,
            targetDir,
            lock,
            force: opts.force,
            yes: opts.yes,
          });
          if (r.ok === false) {
            console.error(colors.red('error:'), r.error);
            process.exit(1);
          }
          console.log(colors.green('✓'), `${r.extensionId}@${r.version} (store)`);
          return;
        }

        if (npmExplicit) {
          const spec = installTarget;
          console.log(colors.cyan('📦'), `Installing from npm: ${spec}…`);
          try {
            const transaction = await stageExtensionNpm(spec, targetDir);
            await commitStagedWithLock(transaction, opts.force, lock, () =>
              upsertNpmExtensionLock(
                lock,
                targetDir,
                { ok: true, extensionId: transaction.extensionId, targetDir: transaction.targetDir },
                spec,
              ));
            console.log(colors.green('✓'), transaction.extensionId, '(npm)');
          } catch (error) {
            console.error(colors.red('error:'), error instanceof Error ? error.message : String(error));
            process.exit(1);
          }
          return;
        }

        if (looksLikeLocalPath(installTarget)) {
          const sourceDir = resolve(process.cwd(), installTarget);
          console.log(colors.cyan('📂'), 'Installing from local directory…');
          try {
            const transaction = await stageExtensionLocal(sourceDir, targetDir);
            const snapshots = readInstalledSnapshots(transaction.stagingRoot, transaction.extensionId);
            const version = typeof snapshots.manifest?.version === 'string'
              ? snapshots.manifest.version
              : '0.0.0';
            await commitStagedWithLock(transaction, opts.force, lock, () => lock.upsert(
              transaction.extensionId,
              {
                name: transaction.extensionId,
                version,
                resolved: sourceDir,
                source: 'local',
                localPath: sourceDir,
                installedIntegrity: computeExtensionDirectoryIntegrity(transaction.targetDir),
                ...readInstalledSnapshots(targetDir, transaction.extensionId),
              },
            ));
            console.log(colors.green('✓'), transaction.extensionId);
          } catch (error) {
            console.error(colors.red('error:'), error instanceof Error ? error.message : String(error));
            process.exit(1);
          }
          return;
        }

        console.error(
          colors.red('error:'),
          'Extension installs require an explicit source: store:<id>, npm:<package>, or a local directory path.',
        );
        process.exit(1);
      },
    );
}

export function createExtensionSearchCommand(): Command {
  return new Command('search')
    .description('Search extensions listed on xopc-store')
    .argument('[keyword]', 'Search text (omit to list all)', '')
    .option('--category <cat>', 'Filter by category')
    .option('--json', 'JSON output')
    .action(async (keyword: string, opts: { category?: string; json?: boolean }) => {
      try {
        let rows;
        if (opts.category?.trim()) {
          rows = await marketplace.listExtensions(opts.category.trim());
          if (keyword.trim()) {
            const k = keyword.trim().toLowerCase();
            rows = rows.filter(
              (e) =>
                e.id.toLowerCase().includes(k) ||
                e.name.toLowerCase().includes(k) ||
                (e.description ?? '').toLowerCase().includes(k),
            );
          }
        } else if (keyword.trim()) {
          rows = await marketplace.searchExtensions(keyword.trim());
        } else {
          const reg = await marketplace.fetchRegistry();
          rows = reg.extensions;
        }

        if (opts.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }

        if (rows.length === 0) {
          console.log('No extensions found.');
          return;
        }

        console.log(`xopc-store: ${marketplace.getExtensionMarketplaceStoreBaseUrl()}`);
        console.log('');
        for (const e of rows) {
          const badge = e.verified ? ` ${colors.green('✓')}` : '';
          console.log(`${colors.cyan(e.name)}${badge} ${colors.gray(e.version ?? '')}`);
          console.log(`  id: ${e.id}  npm: ${e.npmPackage}`);
          if (e.description) console.log(`  ${e.description}`);
          if (e.categories?.length) console.log(`  categories: ${e.categories.join(', ')}`);
          console.log('');
        }
      } catch (err) {
        console.error(colors.red('Error:'), err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}

export function createExtensionPublishCommand(): Command {
  return new Command('publish')
    .description('Publish extension to npm (public)')
    .argument('[directory]', 'Extension root', '.')
    .option('--dry-run', 'npm publish --dry-run', false)
    .option('--access <level>', 'npm access', 'public')
    .action((dir: string, opts: { dryRun: boolean; access: string }) => {
      const root = resolve(dir || '.');
      const manifestPath = join(root, MANIFEST);
      const pkgPath = join(root, 'package.json');
      if (!existsSync(manifestPath) || !existsSync(pkgPath)) {
        console.error(colors.red('error:'), `Need ${MANIFEST} and package.json in ${root}`);
        process.exit(1);
      }
      const validation = validateExtensionPackageDirectory(root);
      for (const d of validation.diagnostics) {
        const label = d.level === 'error' ? colors.red('error') : d.level === 'warning' ? colors.yellow('warning') : colors.cyan('info');
        console.log(`${label}:`, d.message);
      }
      if (!validation.ok || !validation.manifest?.id) {
        console.error(colors.red('error:'), 'Package is not publishable as an independent extension.');
        process.exit(1);
      }

      const args = ['publish', `--access=${opts.access}`];
      if (opts.dryRun) args.push('--dry-run');
      console.log(colors.cyan('Running:'), `npm ${args.join(' ')}`);
      try {
        execSync(`npm ${args.join(' ')}`, { cwd: root, stdio: 'inherit' });
      } catch {
        process.exit(1);
      }
    });
}

export function createExtensionUpdateCommand(): Command {
  return new Command('update')
    .description('Update installed extensions and Agent Plugins from their recorded sources')
    .argument('[extensionId]', 'Specific extension or plugin:<name> (default: all installed)')
    .option('-y, --yes', 'Accept changed plugin capabilities')
    .action(async (extensionId: string | undefined, options: { yes?: boolean }) => {
      if (extensionId?.startsWith('plugin:')) {
        const id = extensionId.slice(7);
        const receipt = new AgentPluginStore().receipt(id);
        if (!receipt) throw new Error('Plugin not installed');
        await installAgentPluginFromCli(receipt.source, { yes: options.yes, force: true, expectedId: id });
        return;
      }
      const ctx = getContextWithOpts();
      const cfg = loadConfig(ctx.configPath);
      const targetDir = resolveExtensionsDir();
      const storeBase = resolveExtensionsStoreBaseUrl(cfg);

      const lock = getExtensionLockfileManager();
      const data = await lock.load();
      const ids = extensionId?.trim()
        ? [extensionId.trim()]
        : Object.keys(data.extensions);

      const plugins = extensionId ? [] : new AgentPluginStore().list();
      for (const plugin of plugins) {
        await installAgentPluginFromCli(plugin.receipt.source, { yes: options.yes, force: true, expectedId: plugin.id });
      }
      if (ids.length === 0 && plugins.length === 0) {
        console.log('No extensions in lockfile.');
        return;
      }

      for (const id of ids) {
        const entry = data.extensions[id];
        if (!entry) {
          console.log(colors.yellow('skip'), id, '(not in lockfile)');
          continue;
        }
        if (entry.source === 'store') {
          const pkgName = entry.resolved?.trim() || id;
          console.log(colors.cyan('Updating'), id, '←', `store:${pkgName}`);
          const r = await installExtensionFromStoreWithLock({
            storeBase,
            packageName: pkgName,
            expectedExtensionId: id,
            targetDir,
            lock,
            force: true,
            yes: true,
          });
          if (r.ok === false) {
            console.error(colors.red('error:'), r.error ?? id);
            process.exit(1);
          }
          console.log(colors.green('✓'), id);
          continue;
        }
        if (entry.source !== 'npm') {
          console.log(colors.yellow('skip'), id, `(source ${entry.source})`);
          continue;
        }
        const spec = entry.resolved?.trim() || (await npmPackageForId(id));
        if (!spec) {
          console.log(colors.yellow('skip'), id, '(could not resolve npm package)');
          continue;
        }
        console.log(colors.cyan('Updating'), id, '←', spec);
        try {
          const transaction = await stageExtensionNpm(spec, targetDir);
          if (transaction.extensionId !== id) {
            rollbackStagedExtensionInstall(transaction);
            throw new Error(`Expected extension ${id}, received ${transaction.extensionId}`);
          }
          await commitStagedWithLock(transaction, true, lock, () =>
            upsertNpmExtensionLock(
              lock,
              targetDir,
              { ok: true, extensionId: transaction.extensionId, targetDir: transaction.targetDir },
              spec,
            ));
          console.log(colors.green('✓'), id);
        } catch (error) {
          console.error(colors.red('error:'), error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      }
    });
}

async function npmPackageForId(id: string): Promise<string | undefined> {
  const found = await marketplace.findExtension(id);
  return found?.npmPackage;
}
