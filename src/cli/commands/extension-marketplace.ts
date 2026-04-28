import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command } from 'commander';

import { resolveDefaultAgentId } from '../../agent/agent-scope.js';
import { loadConfig } from '../../config/loader.js';
import { resolveWorkspaceExtensionsDir } from '../../config/paths.js';
import { installFromNpm, resolveExtensionsDir } from '../../extensions/install.js';
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

export function createExtensionSearchCommand(): Command {
  return new Command('extension:search')
    .alias('ext:search')
    .description('Search the curated extension registry')
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

        console.log(`Registry: ${marketplace.getRegistryUrl()}`);
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
  return new Command('extension:publish')
    .alias('ext:publish')
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
  return new Command('extension:update')
    .alias('ext:update')
    .description('Re-install extension(s) from npm using the lockfile / registry')
    .argument('[extensionId]', 'Specific extension id (default: all in lockfile)')
    .option('--global', 'Use global extensions directory', false)
    .action(async (extensionId: string | undefined, opts: { global: boolean }) => {
      const ctx = getContextWithOpts();
      const cfg = loadConfig(ctx.configPath);
      const agentId = resolveDefaultAgentId(cfg);
      const targetDir = opts.global
        ? resolveExtensionsDir(ctx.workspacePath, true)
        : resolveWorkspaceExtensionsDir(cfg, agentId);

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
        const result = await installFromNpm(spec, targetDir);
        if (!result.ok) {
          console.error(colors.red('error:'), result.error ?? id);
          process.exit(1);
        }
        console.log(colors.green('✓'), id);
      }
    });
}

async function npmPackageForId(id: string): Promise<string | undefined> {
  const found = await marketplace.findExtension(id);
  return found?.npmPackage;
}
