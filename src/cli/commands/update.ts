// src/cli/commands/update.ts

import { Command } from 'commander';

import { loadConfig } from '../../config/index.js';
import {
  formatGlobalInstallFailure,
  resolveGlobalInstallSpec,
  resolveGlobalManager,
  runGlobalPackageInstall,
} from '../../infra/update-global.js';
import { normalizeUpdateChannel, DEFAULT_PACKAGE_CHANNEL } from '../../infra/update-channels.js';
import {
  resolveNpmChannelTag,
  compareSemver,
  detectInstallKind,
  resolvePackageRoot,
} from '../../infra/update-check.js';
import { PACKAGE_VERSION } from '../../package-version.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

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

        const packageManager = await resolveGlobalManager({ root });
        const spec = resolveGlobalInstallSpec({ version: resolved.version });

        if (!options.json) {
          console.log(`Installing ${spec} via ${packageManager}...`);
        }

        const { acquireUpdateLock } = await import('../../infra/update-lock.js');
        const lock = process.env.XOPC_AUTO_UPDATE
          ? { release: async () => {} }
          : await acquireUpdateLock('cli');
        if (!lock) {
          const message = 'Another update is already in progress. Try again later.';
          if (options.json) {
            console.log(JSON.stringify({ status: 'error', reason: 'lock-held', message }));
          } else {
            console.error(`❌ ${message}`);
          }
          process.exit(1);
        }

        let installResult: Awaited<ReturnType<typeof runGlobalPackageInstall>>;
        try {
          installResult = await runGlobalPackageInstall({
            manager: packageManager,
            spec,
            pkgRoot: root,
            echoToTerminal: !options.json,
          });
        } finally {
          await lock.release();
        }

        if (installResult.exitCode === 0) {
          if (options.json) {
            console.log(
              JSON.stringify({
                status: 'ok',
                previousVersion: PACKAGE_VERSION,
                installedVersion: resolved.version,
                channel: resolved.tag,
                packageManager: installResult.packageManager,
              }),
            );
          } else {
            console.log(`✅ Updated to v${resolved.version}`);
            console.log('Restart the gateway to use the new version: xopc gateway restart');
          }
        } else {
          const message = formatGlobalInstallFailure({
            packageManager: installResult.packageManager,
            spec,
            exitCode: installResult.exitCode,
            stderr: installResult.stderr,
            usedFallback: installResult.usedFallback,
          });
          if (options.json) {
            console.log(
              JSON.stringify({
                status: 'error',
                reason: 'install-failed',
                exitCode: installResult.exitCode,
                packageManager: installResult.packageManager,
                usedFallback: installResult.usedFallback,
                stderrTail: installResult.stderr.trim().slice(-4000) || undefined,
                message,
              }),
            );
          } else {
            console.error(`❌ Update failed (exit code ${installResult.exitCode})`);
            console.error(message);
          }
          process.exit(1);
        }
      },
    );
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
