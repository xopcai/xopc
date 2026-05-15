import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command } from 'commander';
import semver from 'semver';

import {
  downloadExtensionStoreZipBuffer,
  resolveExtensionZipDownloadUrl,
  resolveExtensionsStoreBaseUrl,
} from '../../agent/skills/marketplace/adapters/store/store-api-client.js';
import { loadConfig } from '../../config/loader.js';
import { resolveExtensionsDir } from '../../config/paths.js';
import type { InstallResult } from '../../extensions/install.js';
import {
  installExtensionFromStoreZip,
  installFromLocal,
  installFromNpm,
  peekExtensionIdFromStoreZip,
} from '../../extensions/install.js';
import { getExtensionLockfileManager } from '../../extensions/lockfile.js';
import * as marketplace from '../../extensions/marketplace.js';
import { normalizeExtensionManifest } from '../../extensions/normalize-manifest.js';
import { colors } from '../utils/colors.js';
import { getContextWithOpts } from '../index.js';

const MANIFEST = 'xopc.extension.json';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function hasWorkspaceDeps(pkg: Record<string, unknown>): boolean {
  const deps = pkg.dependencies;
  const dev = pkg.devDependencies;
  const check = (d: unknown) => {
    if (!isRecord(d)) return false;
    return Object.values(d).some((v) => typeof v === 'string' && v.startsWith('workspace:'));
  };
  return check(deps) || check(dev);
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

function looksLikeStorePackageRef(raw: string): boolean {
  const { name } = parseNameAtVersion(raw);
  return STORE_NAME_RE.test(name);
}

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
  });
}

async function installExtensionFromStoreWithLock(params: {
  storeBase: string;
  packageName: string;
  version?: string;
  targetDir: string;
  lock: ReturnType<typeof getExtensionLockfileManager>;
  force?: boolean;
}): Promise<{ ok: true; extensionId: string; version: string } | { ok: false; error: string }> {
  try {
    const { downloadUrl, version } = await resolveExtensionZipDownloadUrl(
      params.storeBase,
      params.packageName,
      params.version,
    );
    console.log(
      colors.cyan('📦'),
      `Downloading ${params.packageName}@${version} from xopc-store (${params.storeBase})…`,
    );
    const buf = await downloadExtensionStoreZipBuffer(params.storeBase, downloadUrl);
    if (params.force) {
      const id = peekExtensionIdFromStoreZip(buf);
      if (id && existsSync(join(params.targetDir, id))) {
        rmSync(join(params.targetDir, id), { recursive: true, force: true });
      }
    }
    const result = await installExtensionFromStoreZip(buf, params.targetDir);
    if (!result.ok || !result.extensionId) {
      return { ok: false, error: result.error ?? 'install failed' };
    }
    await params.lock.upsert(result.extensionId, {
      name: result.extensionId,
      version,
      resolved: params.packageName,
      source: 'store',
    });
    return { ok: true, extensionId: result.extensionId, version };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export function createExtensionInstallCommand(): Command {
  return new Command('install')
    .description(
      'Install extension from xopc-store (store.xopc.ai), npm, or a local directory into ~/.xopc/extensions',
    )
    .argument(
      '<target>',
      'npm spec, path, store:id, or store-shaped id (npm is tried first; use --store / store: for store-only)',
    )
    .option('--store', 'Install from xopc-store only (fail if not an extension package)', false)
    .option('--npm', 'Install from npm only', false)
    .option(
      '-f, --force',
      'Remove existing extension folder (manifest id) before store or local install',
      false,
    )
    .action(
      async (
        target: string,
        opts: { store: boolean; npm: boolean; force: boolean },
      ) => {
        const ctx = getContextWithOpts();
        const cfg = loadConfig(ctx.configPath);
        const targetDir = resolveExtensionsDir();
        const lock = getExtensionLockfileManager();

        let installTarget = target.trim();
        const storeExplicit = /^store:/i.test(installTarget);
        if (storeExplicit) {
          installTarget = installTarget.replace(/^store:/i, '').trim();
        }
        if (!installTarget) {
          console.error(colors.red('error:'), 'Missing target');
          process.exit(1);
        }

        if (opts.store && opts.npm) {
          console.error(colors.red('error:'), 'Use only one of --store and --npm');
          process.exit(1);
        }

        const storeOnly = opts.store || storeExplicit;
        if (storeExplicit && opts.npm) {
          console.error(colors.red('error:'), 'Cannot combine store: prefix with --npm');
          process.exit(1);
        }

        const storeBase = resolveExtensionsStoreBaseUrl(cfg);

        if (storeOnly) {
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
          });
          if (r.ok === false) {
            console.error(colors.red('error:'), r.error);
            process.exit(1);
          }
          console.log(colors.green('✓'), `${r.extensionId}@${r.version} (store)`);
          return;
        }

        if (opts.npm) {
          const spec = installTarget;
          console.log(colors.cyan('📦'), `Installing from npm: ${spec}…`);
          const result = await installFromNpm(spec, targetDir);
          if (!result.ok) {
            console.error(colors.red('error:'), result.error ?? 'install failed');
            process.exit(1);
          }
          await upsertNpmExtensionLock(lock, targetDir, result, spec);
          console.log(colors.green('✓'), result.extensionId ?? 'ok', '(npm)');
          return;
        }

        if (looksLikeLocalPath(installTarget)) {
          const sourceDir = resolve(process.cwd(), installTarget);
          if (opts.force) {
            const manifestPath = join(sourceDir, MANIFEST);
            if (existsSync(manifestPath)) {
              try {
                const raw = readFileSync(manifestPath, 'utf-8');
                const m = JSON.parse(raw) as { id?: string };
                const extId =
                  typeof m.id === 'string' &&
                  m.id &&
                  !m.id.includes('/') &&
                  !m.id.includes('\\')
                    ? m.id
                    : undefined;
                if (extId && existsSync(join(targetDir, extId))) {
                  rmSync(join(targetDir, extId), { recursive: true, force: true });
                }
              } catch {
                /* installFromLocal will surface manifest errors */
              }
            }
          }
          console.log(colors.cyan('📂'), 'Installing from local directory…');
          const result = await installFromLocal(sourceDir, targetDir);
          if (!result.ok) {
            console.error(colors.red('error:'), result.error ?? 'install failed');
            process.exit(1);
          }
          console.log(colors.green('✓'), result.extensionId ?? 'ok');
          return;
        }

        if (looksLikeStorePackageRef(installTarget)) {
          const spec = installTarget;
          console.log(colors.cyan('📦'), `Trying npm: ${spec}…`);
          const npmTry = await installFromNpm(spec, targetDir);
          if (npmTry.ok) {
            await upsertNpmExtensionLock(lock, targetDir, npmTry, spec);
            console.log(colors.green('✓'), npmTry.extensionId ?? 'ok', '(npm)');
            return;
          }
          console.log(colors.yellow('npm:'), npmTry.error ?? 'failed', '— trying xopc-store…');
          const { name: pkgName, version: ver } = parseNameAtVersion(installTarget);
          const r = await installExtensionFromStoreWithLock({
            storeBase,
            packageName: pkgName,
            version: ver,
            targetDir,
            lock,
            force: opts.force,
          });
          if (r.ok === false) {
            console.error(colors.red('error:'), r.error);
            process.exit(1);
          }
          console.log(colors.green('✓'), `${r.extensionId}@${r.version} (store)`);
          return;
        }

        const spec = installTarget;
        console.log(colors.cyan('📦'), `Installing from npm: ${spec}…`);
        const result = await installFromNpm(spec, targetDir);
        if (!result.ok) {
          console.error(colors.red('error:'), result.error ?? 'install failed');
          process.exit(1);
        }
        await upsertNpmExtensionLock(lock, targetDir, result, spec);
        console.log(colors.green('✓'), result.extensionId ?? 'ok', '(npm)');
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
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        if (hasWorkspaceDeps(pkg)) {
          console.error(
            colors.red('error:'),
            'Remove workspace:* dependencies before publishing.',
          );
          process.exit(1);
        }
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
        const manifest = normalizeExtensionManifest(raw);
        if (!manifest.id) {
          console.error(colors.red('error:'), 'Invalid manifest id');
          process.exit(1);
        }
      } catch (e) {
        console.error(colors.red('error:'), e instanceof Error ? e.message : String(e));
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
    .description('Re-install extension(s) from the lockfile (npm or xopc-store) under ~/.xopc/extensions')
    .argument('[extensionId]', 'Specific extension id (default: all in lockfile)')
    .action(async (extensionId: string | undefined) => {
      const ctx = getContextWithOpts();
      const cfg = loadConfig(ctx.configPath);
      const targetDir = resolveExtensionsDir();
      const storeBase = resolveExtensionsStoreBaseUrl(cfg);

      const lock = getExtensionLockfileManager();
      const data = await lock.load();
      const ids = extensionId?.trim()
        ? [extensionId.trim()]
        : Object.keys(data.extensions);

      if (ids.length === 0) {
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
          if (existsSync(join(targetDir, id))) {
            rmSync(join(targetDir, id), { recursive: true, force: true });
          }
          const r = await installExtensionFromStoreWithLock({
            storeBase,
            packageName: pkgName,
            targetDir,
            lock,
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
        if (existsSync(join(targetDir, id))) {
          rmSync(join(targetDir, id), { recursive: true, force: true });
        }
        const result = await installFromNpm(spec, targetDir);
        if (!result.ok) {
          console.error(colors.red('error:'), result.error ?? id);
          process.exit(1);
        }
        await lock.upsert(id, {
          name: id,
          version: entry.version,
          resolved: spec,
          source: 'npm',
        });
        console.log(colors.green('✓'), id);
      }
    });
}

async function npmPackageForId(id: string): Promise<string | undefined> {
  const found = await marketplace.findExtension(id);
  return found?.npmPackage;
}
