import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from 'commander';

import { loadConfig, saveConfig } from '../../config/loader.js';
import { resolveExtensionsDir } from '../../config/paths.js';
import { checkEngineCompatibility } from '../../extensions/engine-check.js';
import { ExtensionLoader } from '../../extensions/loader.js';
import { collectExtensionPackageDependencyIssues } from '../../extensions/package-contract.js';
import { PACKAGE_VERSION } from '../../package-version.js';
import { createLogger } from '../../utils/logger.js';
import { getExtensionLockfileManager } from '../../extensions/lockfile.js';
import {
  getExtensionHealthChecker,
  checkAllExtensionsHealth,
} from '../../extensions/health.js';
import { getContextWithOpts } from '../context.js';
import { colors } from '../utils/colors.js';
import { createExtensionPackCommand } from './extension-pack.js';
import { createExtensionCreateCommand } from './extension-create.js';
import { createExtensionDevCommand } from './extension-dev.js';
import {
  createExtensionInstallCommand,
  createExtensionPublishCommand,
  createExtensionSearchCommand,
  createExtensionUpdateCommand,
} from './extension-marketplace.js';

const log = createLogger('ExtensionCommands');

// ============================================
// Extension List Command
// ============================================

export function createExtensionListCommand(): Command {
  return new Command('list')
    .description('List installed extensions')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const lockfileManager = getExtensionLockfileManager();
        const extensions = await lockfileManager.list();

        if (options.json) {
          console.log(JSON.stringify(extensions, null, 2));
          return;
        }

        if (extensions.length === 0) {
          console.log('No extensions installed.');
          return;
        }

        console.log(`Installed extensions (${extensions.length}):`);
        console.log();

        for (const ext of extensions) {
          console.log(`${colors.cyan(ext.name)}@${ext.version}`);
          console.log(`  Source: ${ext.source}`);
          console.log(`  Resolved: ${ext.resolved}`);
          console.log(`  Installed: ${new Date(ext.installedAt).toLocaleString()}`);
          console.log();
        }
      } catch (error) {
        log.error({ error }, 'Failed to list extensions');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Extension Inspect Command
// ============================================

function hashInstalledExtensionDir(extensionDir: string): string | undefined {
  if (!existsSync(extensionDir)) return undefined;
  const hash = createHash('sha256');
  const walk = (dir: string, prefix = '') => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.name !== 'node_modules')
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        const st = statSync(full);
        hash.update(`file\0${rel}\0${st.size}\0`);
        hash.update(readFileSync(full));
        hash.update('\0');
      }
    }
  };
  walk(extensionDir);
  return `dir-sha256-${hash.digest('base64')}`;
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function createExtensionInspectCommand(): Command {
  return new Command('inspect')
    .description('Inspect an installed extension manifest and package contract')
    .argument('<extension>', 'Extension id')
    .option('--json', 'Output as JSON')
    .option('--runtime', 'Load the extension and include runtime registrations')
    .action(async (extensionId: string, options: { json?: boolean; runtime?: boolean }) => {
      try {
        const lockfileManager = getExtensionLockfileManager();
        const lockEntry = await lockfileManager.get(extensionId);
        const extensionDir = join(resolveExtensionsDir(), extensionId);
        const manifest = readJson(join(extensionDir, 'xopc.extension.json')) ?? lockEntry?.manifest;
        const packageJson = readJson(join(extensionDir, 'package.json')) ?? lockEntry?.packageJson;
        let runtime: Record<string, unknown> | undefined;
        if (options.runtime) {
          const loader = new ExtensionLoader({
            workspaceDir: process.cwd(),
            extensionsDir: resolveExtensionsDir(),
          });
          const api = await loader.loadExtension({
            id: extensionId,
            name: String(manifest?.name ?? extensionId),
            path: extensionDir,
            source: 'global',
            enabled: true,
            config: {},
          });
          const registry = loader.getRegistry();
          runtime = api
            ? {
                loaded: true,
                tools: Array.from(registry.tools.keys()),
                commands: Array.from(registry.commands.keys()),
                hooks: Array.from(registry.hooks.keys()),
                channels: registry.channelPlugins.map((p) => p.id),
                httpRoutes: Array.from(registry.httpRoutes.keys()),
                gatewayMethods: Array.from(registry.gatewayMethods.keys()),
                services: Array.from(registry.services.keys()),
                cliCommands: registry.getCliRegistrations().flatMap((r) => r.commands),
                tui: registry.getTuiRegistrations().map((r) => r.extensionId),
              }
            : { loaded: false, diagnostics: loader.getDiagnostics().getAll() };
        }

        const runtimeContractCheck = buildRuntimeContractCheck(manifest, runtime);
        const result = {
          id: extensionId,
          installed: Boolean(lockEntry),
          path: existsSync(extensionDir) ? extensionDir : undefined,
          lockEntry,
          manifest,
          packageJson,
          runtime,
          runtimeContractCheck,
        };

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (!lockEntry && !manifest) {
          console.error(colors.red('error:'), `Extension not found: ${extensionId}`);
          process.exit(1);
        }

        console.log(`${colors.cyan(String(manifest?.name ?? extensionId))} (${extensionId})`);
        if (manifest?.version || lockEntry?.version) {
          console.log(`  Version: ${String(manifest?.version ?? lockEntry?.version)}`);
        }
        if (lockEntry) {
          console.log(`  Source: ${lockEntry.source}`);
          console.log(`  Resolved: ${lockEntry.resolved}`);
          if (lockEntry.integrity) console.log(`  Integrity: ${lockEntry.integrity}`);
        }
        if (manifest?.main) console.log(`  Main: ${String(manifest.main)}`);
        const engines = manifest?.engines as Record<string, unknown> | undefined;
        if (engines?.xopc) console.log(`  engines.xopc: ${String(engines.xopc)}`);
        const contracts = manifest?.contracts as Record<string, unknown> | undefined;
        if (contracts) {
          console.log('  Contracts:');
          for (const [key, value] of Object.entries(contracts)) {
            if (Array.isArray(value) && value.length > 0) {
              console.log(`    ${key}: ${value.join(', ')}`);
            }
          }
        }
        if (runtime) {
          console.log('  Runtime:');
          if (runtime.loaded === false) {
            console.log('    loaded: false');
          } else {
            for (const [key, value] of Object.entries(runtime)) {
              if (key === 'loaded') continue;
              if (Array.isArray(value) && value.length > 0) {
                console.log(`    ${key}: ${value.join(', ')}`);
              }
            }
          }
          if (runtimeContractCheck.length > 0) {
            console.log('  Runtime contract check:');
            for (const check of runtimeContractCheck) {
              const marker = check.status === 'registered' ? colors.green('✓') : colors.red('✗');
              const suffix = check.status === 'missing' ? ' declared but not registered' : '';
              console.log(`    ${marker} ${check.contract}.${check.declared}${suffix}`);
            }
          }
        }
      } catch (error) {
        log.error({ error }, 'Failed to inspect extension');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Extension Freeze Command
// ============================================

export function createExtensionFreezeCommand(): Command {
  return new Command('freeze')
    .description('Lock current extension versions')
    .action(async () => {
      try {
        const lockfileManager = getExtensionLockfileManager();
        await lockfileManager.freeze();

        console.log(colors.green('✓'), 'Extension versions locked');
      } catch (error) {
        log.error({ error }, 'Failed to freeze extensions');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Extension Health Command
// ============================================

export function createExtensionHealthCommand(): Command {
  return new Command('health')
    .description('Check extension health')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const checker = getExtensionHealthChecker();
        const report = await checkAllExtensionsHealth();

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        console.log(checker.formatReport(report));

        // Exit with error code if there are errors
        if (report.summary.error > 0) {
          process.exit(1);
        }
      } catch (error) {
        log.error({ error }, 'Failed to check extension health');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Extension Verify Command
// ============================================

export function createExtensionVerifyCommand(): Command {
  return new Command('verify')
    .description('Verify extension integrity')
    .argument('[extension]', 'Specific extension to verify (default: all)')
    .action(async (extensionId) => {
      try {
        const lockfileManager = getExtensionLockfileManager();

        if (extensionId) {
          const result = await lockfileManager.verify(extensionId);

          if (result.valid) {
            console.log(colors.green('✓'), `Extension "${extensionId}" is valid`);
          } else {
            console.log(colors.red('✗'), `Extension "${extensionId}" is invalid: ${result.reason}`);
            process.exit(1);
          }
        } else {
          const results = await lockfileManager.verifyAll();
          let hasErrors = false;

          for (const result of results) {
            if (result.valid) {
              console.log(colors.green('✓'), result.extensionId);
            } else {
              console.log(colors.red('✗'), `${result.extensionId}: ${result.reason}`);
              hasErrors = true;
            }
          }

          if (hasErrors) {
            process.exit(1);
          }
        }
      } catch (error) {
        log.error({ error }, 'Failed to verify extensions');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Extension Doctor Command
// ============================================

interface DoctorIssue {
  level: 'error' | 'warning';
  extensionId: string;
  message: string;
}

function listContractValues(manifest: Record<string, unknown>, key: string): string[] {
  const contracts = manifest.contracts;
  if (typeof contracts !== 'object' || contracts === null || Array.isArray(contracts)) return [];
  const value = (contracts as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function contractAllows(values: string[], candidate: string): boolean {
  return values.some((value) => value === candidate || (value.endsWith('*') && candidate.startsWith(value.slice(0, -1))));
}

function buildRuntimeContractCheck(
  manifest: Record<string, unknown> | undefined,
  runtime: Record<string, unknown> | undefined,
): Array<{ contract: string; declared: string; status: 'registered' | 'missing' }> {
  if (!manifest || !runtime || runtime.loaded === false) return [];
  const out: Array<{ contract: string; declared: string; status: 'registered' | 'missing' }> = [];
  for (const key of ['tools', 'commands', 'hooks', 'channels', 'httpRoutes', 'gatewayMethods', 'services', 'cliCommands', 'tui']) {
    const declared = listContractValues(manifest, key);
    const registered = Array.isArray(runtime[key]) ? (runtime[key] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    for (const item of declared) {
      if (item.endsWith('*')) continue;
      out.push({
        contract: key,
        declared: item,
        status: registered.includes(item) ? 'registered' : 'missing',
      });
    }
  }
  return out;
}

function collectStringLiteralCalls(source: string, method: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\.${method}\\(\\s*['\"]([^'\"]+)['\"]`, 'g');
  for (const match of source.matchAll(re)) {
    if (match[1]) out.push(match[1]);
  }
  return out;
}

function collectObjectNameRegistrations(source: string, method: string, field: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\.${method}\\(\\s*\\{[\\s\\S]*?\\b${field}\\s*:\\s*['\"]([^'\"]+)['\"]`, 'g');
  for (const match of source.matchAll(re)) {
    if (match[1]) out.push(match[1]);
  }
  return out;
}

function diagnoseExtensionPackage(extensionId: string, extensionDir: string): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  const manifest = readJson(join(extensionDir, 'xopc.extension.json'));
  if (!manifest) {
    return [{ level: 'error', extensionId, message: 'Missing xopc.extension.json' }];
  }

  const main = typeof manifest.main === 'string' ? manifest.main : '';
  if (!main) {
    issues.push({ level: 'error', extensionId, message: 'manifest.main is required' });
  } else if (!/\.(js|mjs|cjs)$/i.test(main)) {
    issues.push({ level: 'error', extensionId, message: `manifest.main must point at built JavaScript, got ${main}` });
  } else if (!existsSync(join(extensionDir, main))) {
    issues.push({ level: 'error', extensionId, message: `manifest.main target does not exist: ${main}` });
  }

  const engines = manifest.engines;
  const xopcRange = typeof engines === 'object' && engines !== null && !Array.isArray(engines)
    ? (engines as Record<string, unknown>).xopc
    : undefined;
  if (typeof xopcRange !== 'string' || !xopcRange.trim()) {
    issues.push({ level: 'error', extensionId, message: 'engines.xopc is required' });
  } else {
    const engineCheck = checkEngineCompatibility(PACKAGE_VERSION, xopcRange);
    if (engineCheck.parseWarning || !engineCheck.compatible) {
      issues.push({
        level: 'error',
        extensionId,
        message: engineCheck.reason ?? `xopc ${PACKAGE_VERSION} does not satisfy engines.xopc ${xopcRange}`,
      });
    }
  }

  const pkg = readJson(join(extensionDir, 'package.json'));
  if (pkg) {
    for (const issue of collectExtensionPackageDependencyIssues(pkg, { strictRuntimeSdkDeps: true })) {
      issues.push({ level: 'error', extensionId, message: issue.message });
    }
  }

  if (main && existsSync(join(extensionDir, main))) {
    const source = readFileSync(join(extensionDir, main), 'utf-8');
    const checks: Array<{ contract: string; values: string[] }> = [
      { contract: 'hooks', values: collectStringLiteralCalls(source, 'registerHook') },
      { contract: 'hooks', values: collectStringLiteralCalls(source, 'onHook') },
      { contract: 'httpRoutes', values: collectStringLiteralCalls(source, 'registerHttpRoute') },
      { contract: 'gatewayMethods', values: collectStringLiteralCalls(source, 'registerGatewayMethod') },
      { contract: 'tools', values: collectObjectNameRegistrations(source, 'registerTool', 'name') },
      { contract: 'commands', values: collectObjectNameRegistrations(source, 'registerCommand', 'name') },
      { contract: 'services', values: collectObjectNameRegistrations(source, 'registerService', 'id') },
    ];
    for (const check of checks) {
      const declared = listContractValues(manifest, check.contract);
      for (const value of check.values) {
        if (!contractAllows(declared, value)) {
          issues.push({
            level: 'error',
            extensionId,
            message: `Runtime registers ${check.contract}:${value} but manifest contracts.${check.contract} does not declare it`,
          });
        }
      }
    }
  }

  return issues;
}

export function createExtensionDoctorCommand(): Command {
  return new Command('doctor')
    .description('Diagnose installed extension package contracts')
    .option('--json', 'Output as JSON')
    .option('--fix', 'Refresh lockfile snapshots and installed file integrity for valid installed extensions')
    .action(async (options: { json?: boolean; fix?: boolean }) => {
      try {
        const ctx = getContextWithOpts();
        const cfg = loadConfig(ctx.configPath) as Record<string, unknown>;
        const extensionsConfig =
          typeof cfg.extensions === 'object' && cfg.extensions !== null && !Array.isArray(cfg.extensions)
            ? (cfg.extensions as Record<string, unknown>)
            : undefined;
        const enabledIds = Array.isArray(extensionsConfig?.enabled)
          ? extensionsConfig.enabled.filter((x): x is string => typeof x === 'string')
          : [];
        const lockfileManager = getExtensionLockfileManager();
        const extensions = await lockfileManager.list();
        const issues: DoctorIssue[] = [];
        const lockDir = resolveExtensionsDir();
        const lockedIds = new Set(extensions.map((entry) => entry.name));
        for (const entry of extensions) {
          const extensionDir = join(lockDir, entry.name);
          if (!existsSync(extensionDir)) {
            issues.push({ level: 'error', extensionId: entry.name, message: 'Lockfile entry exists but extension directory is missing; reinstall the extension' });
            continue;
          }
          const entryIssues = diagnoseExtensionPackage(entry.name, extensionDir);
          issues.push(...entryIssues);
          if (options.fix && entryIssues.length === 0) {
            await lockfileManager.upsert(entry.name, {
              ...entry,
              manifest: readJson(join(extensionDir, 'xopc.extension.json')),
              packageJson: readJson(join(extensionDir, 'package.json')),
              installedIntegrity: hashInstalledExtensionDir(extensionDir),
            });
          }
        }

        for (const enabledId of enabledIds) {
          if (!lockedIds.has(enabledId) && !existsSync(join(lockDir, enabledId))) {
            if (options.fix && extensionsConfig) {
              extensionsConfig.enabled = enabledIds.filter((id) => id !== enabledId);
              issues.push({ level: 'warning', extensionId: enabledId, message: 'Removed from extensions.enabled because it is not installed' });
            } else {
              issues.push({ level: 'error', extensionId: enabledId, message: 'Configured in extensions.enabled but not installed' });
            }
          }
        }
        if (options.fix && extensionsConfig) {
          await saveConfig(cfg as Parameters<typeof saveConfig>[0], ctx.configPath);
        }

        if (existsSync(lockDir)) {
          for (const dirent of readdirSync(lockDir, { withFileTypes: true })) {
            if (!dirent.isDirectory() || lockedIds.has(dirent.name)) continue;
            const extensionDir = join(lockDir, dirent.name);
            const entryIssues = diagnoseExtensionPackage(dirent.name, extensionDir);
            if (entryIssues.length > 0) {
              issues.push(...entryIssues);
              issues.push({ level: 'error', extensionId: dirent.name, message: 'Extension directory is not recorded in the lockfile and cannot be auto-fixed until package contract errors are resolved' });
              continue;
            }
            if (!options.fix) {
              issues.push({ level: 'warning', extensionId: dirent.name, message: 'Extension directory is not recorded in the lockfile' });
            }
            if (options.fix) {
              const manifest = readJson(join(extensionDir, 'xopc.extension.json'));
              const packageJson = readJson(join(extensionDir, 'package.json'));
              await lockfileManager.upsert(dirent.name, {
                name: dirent.name,
                version: String(manifest?.version ?? packageJson?.version ?? '0.0.0'),
                resolved: extensionDir,
                source: 'local',
                manifest,
                packageJson,
                installedIntegrity: hashInstalledExtensionDir(extensionDir),
              });
            }
          }
        }

        if (options.json) {
          console.log(JSON.stringify({ ok: issues.every((i) => i.level !== 'error'), issues }, null, 2));
          return;
        }

        if (issues.length === 0) {
          console.log(colors.green('✓'), options.fix
            ? 'All installed extensions satisfy the package contract; lockfile snapshots refreshed'
            : 'All installed extensions satisfy the package contract');
          return;
        }
        for (const issue of issues) {
          const marker = issue.level === 'error' ? colors.red('✗') : colors.yellow('⚠');
          console.log(marker, `${issue.extensionId}: ${issue.message}`);
        }
        if (issues.some((i) => i.level === 'error')) process.exit(1);
      } catch (error) {
        log.error({ error }, 'Failed to run extension doctor');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Extension Audit Command
// ============================================

export function createExtensionAuditCommand(): Command {
  return new Command('audit')
    .description('Audit extensions for security issues')
    .action(async () => {
      try {
        const checker = getExtensionHealthChecker();

        // Check for orphaned extensions
        const orphaned = await checker.findOrphaned();

        if (orphaned.length > 0) {
          console.log(colors.yellow('⚠'), 'Orphaned extensions found:');
          for (const ext of orphaned) {
            console.log(`  - ${ext}`);
          }
          console.log();
          console.log('These extensions are installed but not in the lockfile.');
          console.log('Run `xopc extensions freeze` to add them.');
        } else {
          console.log(colors.green('✓'), 'No orphaned extensions found');
        }

        // Run health check
        const report = await checkAllExtensionsHealth();

        if (report.summary.error > 0 || report.summary.warning > 0) {
          console.log();
          console.log(checker.formatReport(report));
        } else {
          console.log(colors.green('✓'), 'All extensions are healthy');
        }
      } catch (error) {
        log.error({ error }, 'Failed to audit extensions');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Register All Commands
// ============================================

export function registerExtensionCommands(program: Command): void {
  const extensions = new Command('extensions')
    .description('Manage extensions')
    .addCommand(createExtensionListCommand())
    .addCommand(createExtensionInspectCommand())
    .addCommand(createExtensionFreezeCommand())
    .addCommand(createExtensionHealthCommand())
    .addCommand(createExtensionVerifyCommand())
    .addCommand(createExtensionDoctorCommand())
    .addCommand(createExtensionAuditCommand())
    .addCommand(createExtensionPackCommand())
    .addCommand(createExtensionCreateCommand())
    .addCommand(createExtensionDevCommand())
    .addCommand(createExtensionInstallCommand())
    .addCommand(createExtensionSearchCommand())
    .addCommand(createExtensionPublishCommand())
    .addCommand(createExtensionUpdateCommand());

  program.addCommand(extensions);
}
