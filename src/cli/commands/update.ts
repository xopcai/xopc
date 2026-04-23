// src/cli/commands/update.ts

import { Command } from 'commander';
import { spawn } from 'node:child_process';

import { loadConfig } from '../../config/index.js';
import { PACKAGE_VERSION } from '../../package-version.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { normalizeUpdateChannel, DEFAULT_PACKAGE_CHANNEL } from '../../infra/update-channels.js';
import {
  resolveNpmChannelTag,
  compareSemver,
  detectInstallKind,
  resolvePackageRoot,
} from '../../infra/update-check.js';

function createUpdateCommand(_ctx: CLIContext): Command {
  return new Command('update')
    .description('Check for and install xopc updates')
    .option('--check', 'Only check for updates without installing')
    .option('--yes', 'Skip confirmation prompts')
    .option('--channel <channel>', 'Update channel: stable, beta, or dev (default: from config, else stable)')
    .option('--json', 'Output results as JSON')
    .addHelpText(
      'after',
      formatExamples([
        'xopc update',
        'xopc update --check',
        'xopc update --channel beta',
        'xopc update --yes',
        'xopc update --json',
      ]),
    )
    .action(
      async (options: { check?: boolean; yes?: boolean; channel?: string; json?: boolean }) => {
        const fromCli = options.channel;
        const fromConfig = (() => {
          try {
            return loadConfig().update?.channel;
          } catch {
            return undefined;
          }
        })();
        const channel = normalizeUpdateChannel(fromCli ?? fromConfig) ?? DEFAULT_PACKAGE_CHANNEL;

        // Check current install kind
        const root = await resolvePackageRoot();
        if (root) {
          const installKind = await detectInstallKind(root);
          if (installKind === 'git') {
            const message = 'Running from a git checkout. Use `git pull` to update instead.';
            if (options.json) {
              console.log(JSON.stringify({ status: 'skipped', reason: 'git-checkout', message }));
            } else {
              console.log(message);
            }
            return;
          }
        }

        if (!options.json) {
          console.log(`Checking for updates (channel: ${channel})...`);
        }

        const resolved = await resolveNpmChannelTag({ channel });
        if (!resolved.version) {
          const message = 'Could not reach npm registry. Check your network connection.';
          if (options.json) {
            console.log(JSON.stringify({ status: 'error', reason: 'registry-unreachable', message }));
          } else {
            console.error(message);
          }
          process.exit(1);
        }

        const comparison = compareSemver(PACKAGE_VERSION, resolved.version);
        if (comparison === null || comparison >= 0) {
          const message = `Already up to date: v${PACKAGE_VERSION} (${resolved.tag}: v${resolved.version})`;
          if (options.json) {
            console.log(
              JSON.stringify({
                status: 'up-to-date',
                currentVersion: PACKAGE_VERSION,
                latestVersion: resolved.version,
                channel: resolved.tag,
              }),
            );
          } else {
            console.log(`✅ ${message}`);
          }
          return;
        }

        if (options.check) {
          const message = `Update available: v${PACKAGE_VERSION} → v${resolved.version} (${resolved.tag})`;
          if (options.json) {
            console.log(
              JSON.stringify({
                status: 'update-available',
                currentVersion: PACKAGE_VERSION,
                latestVersion: resolved.version,
                channel: resolved.tag,
              }),
            );
          } else {
            console.log(`📦 ${message}`);
            console.log('Run `xopc update` to install.');
          }
          return;
        }

        if (!options.yes && !process.env.XOPC_AUTO_UPDATE) {
          const { confirm } = await import('@inquirer/prompts');
          const shouldUpdate = await confirm({
            message: `Update from v${PACKAGE_VERSION} to v${resolved.version} (${resolved.tag})?`,
            default: true,
          });
          if (!shouldUpdate) {
            console.log('Update cancelled.');
            return;
          }
        }

        const packageManager = detectGlobalPackageManager();
        const spec = `@xopcai/xopc@${resolved.version}`;

        if (!options.json) {
          console.log(`Installing ${spec} via ${packageManager}...`);
        }

        const installArgs = buildInstallArgs(packageManager, spec);
        const exitCode = await runInstallCommand(installArgs);

        if (exitCode === 0) {
          if (options.json) {
            console.log(
              JSON.stringify({
                status: 'ok',
                previousVersion: PACKAGE_VERSION,
                installedVersion: resolved.version,
                channel: resolved.tag,
                packageManager,
              }),
            );
          } else {
            console.log(`✅ Updated to v${resolved.version}`);
            console.log('Restart the gateway to use the new version: xopc gateway restart');
          }
        } else {
          if (options.json) {
            console.log(
              JSON.stringify({
                status: 'error',
                reason: 'install-failed',
                exitCode,
                packageManager,
              }),
            );
          } else {
            console.error(`❌ Update failed (exit code ${exitCode})`);
            console.error(`Try manually: ${packageManager} install -g ${spec}`);
          }
          process.exit(1);
        }
      },
    );
}

/**
 * Detect which package manager was used to install xopc globally.
 * Checks common indicators: npm_config_user_agent, process.env, argv paths.
 */
function detectGlobalPackageManager(): 'npm' | 'pnpm' {
  const userAgent = process.env.npm_config_user_agent ?? '';
  if (userAgent.startsWith('pnpm/')) return 'pnpm';
  return 'npm';
}

function buildInstallArgs(manager: 'npm' | 'pnpm', spec: string): string[] {
  if (manager === 'pnpm') {
    return ['pnpm', 'add', '-g', spec];
  }
  return ['npm', 'install', '-g', spec, '--no-fund', '--no-audit'];
}

function runInstallCommand(argv: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

register({
  id: 'update',
  name: 'update',
  description: 'Check for and install xopc updates',
  factory: createUpdateCommand,
  metadata: {
    category: 'maintenance',
    examples: [
      'xopc update',
      'xopc update --check',
      'xopc update --channel beta',
      'xopc update --yes --json',
    ],
  },
});
