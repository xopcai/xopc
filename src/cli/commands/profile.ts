import { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import {
  getProfileManager,
  listProfiles,
  createProfile,
  deleteProfile,
  getCurrentProfile,
} from '../../config/profile.js';
import { resolveProfileStateDir } from '../../config/paths.js';
import { colors } from '../utils/colors.js';
import Table from 'cli-table3';

const log = createLogger('ProfileCommands');

// ============================================
// Profile List Command
// ============================================

export function createProfileListCommand(): Command {
  return new Command('profile:list')
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
          console.log('No profiles found. Create one with: xopcbot profile:create <name>');
          return;
        }

        const table = new Table({
          head: ['Name', 'Status', 'Agents', 'Created', 'Directory'].map((h) =>
            colors.cyan(h)
          ),
          colWidths: [15, 10, 8, 20, 40],
        });

        for (const profile of profiles) {
          const status = profile.isActive
            ? colors.green('active')
            : colors.gray('inactive');

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
        console.error(
          colors.red('Error:'),
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}

// ============================================
// Profile Create Command
// ============================================

export function createProfileCreateCommand(): Command {
  return new Command('profile:create')
    .description('Create a new profile')
    .argument('<name>', 'Profile name (letters, numbers, hyphens, underscores)')
    .action(async (name) => {
      try {
        const profile = await createProfile(name);

        console.log(colors.green('✓'), `Created profile "${profile.name}"`);
        console.log(`\n  Directory: ${profile.stateDir}`);
        console.log(`\nTo use this profile:`);
        console.log(`  export XOPCBOT_PROFILE=${profile.name}`);
        console.log(`\nOr add to your shell profile:`);
        console.log(`  echo 'export XOPCBOT_PROFILE=${profile.name}' >> ~/.bashrc`);
      } catch (error) {
        log.error({ error }, 'Failed to create profile');
        console.error(
          colors.red('Error:'),
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}

// ============================================
// Profile Delete Command
// ============================================

export function createProfileDeleteCommand(): Command {
  return new Command('profile:delete')
    .description('Delete a profile')
    .argument('<name>', 'Profile name')
    .option('-f, --force', 'Force delete even if active')
    .action(async (name, options) => {
      try {
        await deleteProfile(name, { force: options.force });

        console.log(colors.green('✓'), `Deleted profile "${name}"`);
      } catch (error) {
        log.error({ error }, 'Failed to delete profile');
        console.error(
          colors.red('Error:'),
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}

// ============================================
// Profile Switch Command
// ============================================

export function createProfileSwitchCommand(): Command {
  return new Command('profile:switch')
    .description('Get shell command to switch to a profile')
    .argument('<name>', 'Profile name')
    .action(async (name) => {
      try {
        const stateDir = resolveProfileStateDir(name);

        // Check if profile exists
        const profiles = await listProfiles();
        const exists = profiles.some((p) => p.name === name);

        if (!exists) {
          console.error(colors.red('Error:'), `Profile "${name}" not found`);
          console.log(`\nCreate it with: xopcbot profile:create ${name}`);
          process.exit(1);
        }

        console.log(colors.cyan('Run this command to switch to this profile:'));
        console.log();
        console.log(`  export XOPCBOT_PROFILE=${name}`);
        console.log();
        console.log('Or add to your shell profile:');
        console.log(`  echo 'export XOPCBOT_PROFILE=${name}' >> ~/.bashrc`);
        console.log();
        console.log(`State directory: ${stateDir}`);
      } catch (error) {
        log.error({ error }, 'Failed to switch profile');
        console.error(
          colors.red('Error:'),
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}

// ============================================
// Register All Commands
// ============================================

export function registerProfileCommands(program: Command): void {
  program.addCommand(createProfileListCommand());
  program.addCommand(createProfileCreateCommand());
  program.addCommand(createProfileDeleteCommand());
  program.addCommand(createProfileSwitchCommand());
}
