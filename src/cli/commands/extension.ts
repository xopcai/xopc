import { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import {
  getExtensionLockfileManager,
  loadExtensionLockfile,
  saveExtensionLockfile,
} from '../../extensions/lockfile.js';
import {
  getExtensionHealthChecker,
  checkAllExtensionsHealth,
} from '../../extensions/health.js';
import { resolveExtensionsDir } from '../../config/paths.js';
import { colors } from '../utils/colors.js';

const log = createLogger('ExtensionCommands');

// ============================================
// Extension List Command
// ============================================

export function createExtensionListCommand(): Command {
  return new Command('extension:list')
    .alias('ext:list')
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
// Extension Freeze Command
// ============================================

export function createExtensionFreezeCommand(): Command {
  return new Command('extension:freeze')
    .alias('ext:freeze')
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
  return new Command('extension:health')
    .alias('ext:health')
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
  return new Command('extension:verify')
    .alias('ext:verify')
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
// Extension Audit Command
// ============================================

export function createExtensionAuditCommand(): Command {
  return new Command('extension:audit')
    .alias('ext:audit')
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
          console.log('Run `xopcbot extension:freeze` to add them.');
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
  program.addCommand(createExtensionListCommand());
  program.addCommand(createExtensionFreezeCommand());
  program.addCommand(createExtensionHealthCommand());
  program.addCommand(createExtensionVerifyCommand());
  program.addCommand(createExtensionAuditCommand());
}
