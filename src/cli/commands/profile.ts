import { Command } from 'commander';
import Table from 'cli-table3';

import { createLogger } from '../../utils/logger.js';
import {
  createProfile,
  deleteProfile,
  getCurrentProfile,
  getSwitchCommand,
  listProfiles,
  resolveProfileStateDir,
} from '../../config/profile.js';
import { formatExamples, register, type CLIContext } from '../registry.js';
import { colors } from '../utils/colors.js';

const log = createLogger('ProfileCommands');

function createProfileCommand(_ctx: CLIContext): Command {
  const cmd = new Command('profile')
    .description('Manage xopc state profiles (~/.xopc vs ~/.xopc-<name>)')
    .addHelpText(
      'after',
      formatExamples([
        'xopc profile list',
        'xopc profile create staging',
        'xopc profile switch staging',
        'xopc profile delete staging --force',
      ]),
    );

  cmd
    .command('list')
    .description('List all profiles')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const profiles = await listProfiles();

        if (options.json) {
          console.log(JSON.stringify(profiles, null, 2));
          return;
        }

        if (profiles.length === 0) {
          console.log('No profiles found. Create one with: xopc profile create <name>');
          return;
        }

        const table = new Table({
          head: ['Name', 'Status', 'Agents', 'Created', 'Directory'].map((h) => colors.cyan(h)),
          colWidths: [15, 10, 8, 20, 40],
        });

        for (const profile of profiles) {
          const status = profile.isActive ? colors.green('active') : colors.gray('inactive');
          table.push([
            profile.name === 'default' ? colors.yellow(profile.name) : profile.name,
            status,
            profile.agentCount.toString(),
            profile.createdAt ? new Date(profile.createdAt).toLocaleDateString() : '-',
            profile.stateDir,
          ]);
        }

        console.log(table.toString());
        console.log(`\nCurrent: ${getCurrentProfile()}`);
      } catch (error) {
        log.error({ error }, 'Failed to list profiles');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  cmd
    .command('create')
    .description('Create a new profile')
    .argument('<name>', 'Profile name (letters, numbers, hyphens, underscores)')
    .action(async (name) => {
      try {
        const profile = await createProfile(name);

        console.log(colors.green('✓'), `Created profile "${profile.name}"`);
        console.log(`\n  Directory: ${profile.stateDir}`);
        console.log('\nTo use this profile:');
        console.log(`  ${getSwitchCommand(profile.name)}`);
      } catch (error) {
        log.error({ error }, 'Failed to create profile');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  cmd
    .command('delete')
    .description('Delete a profile')
    .argument('<name>', 'Profile name')
    .option('-f, --force', 'Force delete even if active')
    .action(async (name, options) => {
      try {
        await deleteProfile(name, { force: options.force });
        console.log(colors.green('✓'), `Deleted profile "${name}"`);
      } catch (error) {
        log.error({ error }, 'Failed to delete profile');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  cmd
    .command('switch')
    .description('Print shell command to switch to a profile')
    .argument('<name>', 'Profile name')
    .action(async (name) => {
      try {
        const profiles = await listProfiles();
        const exists = profiles.some((p) => p.name === name);

        if (!exists) {
          console.error(colors.red('Error:'), `Profile "${name}" not found`);
          console.log(`\nCreate it with: xopc profile create ${name}`);
          process.exit(1);
        }

        console.log(colors.cyan('Run this command to switch to this profile:'));
        console.log();
        console.log(`  ${getSwitchCommand(name)}`);
        console.log();
        console.log(`State directory: ${resolveProfileStateDir(name)}`);
      } catch (error) {
        log.error({ error }, 'Failed to switch profile');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return cmd;
}

register({
  id: 'profile',
  name: 'profile',
  description: 'Manage xopc state profiles (~/.xopc vs ~/.xopc-<name>)',
  factory: createProfileCommand,
  metadata: {
    category: 'setup',
    examples: ['xopc profile list', 'xopc profile create staging'],
  },
});

export { createProfileCommand };
