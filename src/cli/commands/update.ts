// src/cli/commands/update.ts

import { Command } from 'commander';

import { loadConfig } from '../../config/index.js';
import { acquireUpdateLock } from '../../infra/update-lock.js';
import { normalizeUpdateChannel, DEFAULT_PACKAGE_CHANNEL } from '../../infra/update-channels.js';
import {
  resolveNpmChannelTag,
  compareSemver,
} from '../../infra/update-check.js';
import {
  formatUpdateApiResult,
  resolveUpdateInstallSurface,
  runGatewayUpdateWithPostSteps,
} from '../../infra/update-runner.js';
import { PACKAGE_VERSION } from '../../package-version.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

function createUpdateCommand(_ctx: CLIContext): Command {
  return new Command('update')
    .description('Check for and install xopc updates')
    .option('--check', 'Only check for updates without installing')
    .option('--yes', 'Skip confirmation prompts')
    .option('--channel <channel>', 'Update channel: stable, beta, or dev')
    .option('--json', 'Output results as JSON')
    .option('--no-restart', 'Skip gateway restart after a successful update')
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
      async (options: {
        check?: boolean;
        yes?: boolean;
        channel?: string;
        json?: boolean;
        restart?: boolean;
      }) => {
        const fromCli = options.channel;
        const fromConfig = (() => {
          try {
            return loadConfig().update?.channel;
          } catch {
            return undefined;
          }
        })();
        const channel = normalizeUpdateChannel(fromCli ?? fromConfig) ?? DEFAULT_PACKAGE_CHANNEL;

        const surface = await resolveUpdateInstallSurface({
          cwd: process.cwd(),
          argv1: process.argv[1],
        });

        if (options.check) {
          if (surface.kind === 'git') {
            const message = 'Git checkout detected. Run `xopc update` to pull/rebase and build.';
            if (options.json) {
              console.log(JSON.stringify({ status: 'git-checkout', mode: 'git', message }));
            } else {
              console.log(message);
            }
            return;
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

          const message = `Update available: v${PACKAGE_VERSION} → v${resolved.version} (${resolved.tag})`;
          if (options.json) {
            console.log(
              JSON.stringify({
                status: 'update-available',
                currentVersion: PACKAGE_VERSION,
                latestVersion: resolved.version,
                channel: resolved.tag,
                installSurface: surface.kind,
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
          const label =
            surface.kind === 'git'
              ? `Update git checkout via ${channel} channel?`
              : `Update from v${PACKAGE_VERSION} (${channel})?`;
          const shouldUpdate = await confirm({ message: label, default: true });
          if (!shouldUpdate) {
            console.log('Update cancelled.');
            return;
          }
        }

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

        try {
          if (!options.json) {
            console.log(`Running update (channel: ${channel}, surface: ${surface.kind})...`);
          }

          const result = await runGatewayUpdateWithPostSteps({
            channel,
            cwd: process.cwd(),
            argv1: process.argv[1],
            shouldRestart: options.restart !== false,
            progress: options.json
              ? undefined
              : {
                  onStepStart: (step) => {
                    console.log(`→ [${step.index + 1}/${step.total}] ${step.name}`);
                  },
                  onStepComplete: (step) => {
                    if (step.exitCode !== 0 && step.stderrTail) {
                      console.error(step.stderrTail);
                    }
                  },
                },
          });

          const apiResult = formatUpdateApiResult(result, channel);
          if (result.status === 'ok') {
            if (options.json) {
              console.log(JSON.stringify(apiResult));
            } else {
              console.log(`✅ Updated to v${result.after?.version ?? 'unknown'} (${result.mode})`);
              const extOutcomes = result.postUpdate?.extensions?.outcomes ?? [];
              const updatedExt = extOutcomes.filter((o) => o.status === 'updated');
              if (updatedExt.length > 0) {
                console.log(`Extensions synced: ${updatedExt.map((o) => o.extensionId).join(', ')}`);
              }
              const restart = result.postUpdate?.restart;
              if (restart?.ok && restart.mode !== 'skipped') {
                console.log(`Gateway restart: ${restart.message ?? restart.mode}`);
              } else if (!restart?.ok) {
                console.log(
                  restart?.message ??
                    'Restart the gateway to use the new version: xopc gateway restart',
                );
              }
            }
            return;
          }

          if (result.status === 'skipped') {
            if (options.json) {
              console.log(JSON.stringify({ status: 'skipped', reason: result.reason, ...apiResult }));
            } else if (result.reason === 'up-to-date') {
              console.log(`✅ Already up to date: v${PACKAGE_VERSION}`);
            } else if (result.reason === 'dirty') {
              console.error('❌ Git working tree has uncommitted changes. Commit or stash first.');
              process.exit(1);
            } else {
              console.log(`Update skipped: ${result.reason ?? 'unknown'}`);
            }
            return;
          }

          const message =
            typeof apiResult.message === 'string'
              ? apiResult.message
              : result.reason ?? 'Update failed';
          if (options.json) {
            console.log(JSON.stringify({ status: 'error', reason: result.reason, message, ...apiResult }));
          } else {
            console.error(`❌ Update failed: ${message}`);
          }
          process.exit(1);
        } finally {
          await lock.release();
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
