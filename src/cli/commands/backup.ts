import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { Command } from 'commander';

import { createStateBackup, restoreStateBackup, verifyStateBackup } from '../../backup/archive.js';
import { resolveConfigPath, resolveCredentialsDir } from '../../config/paths.js';
import { resolveStateDir } from '../../config/paths-state.js';
import { formatExamples, register, type CLIContext } from '../registry.js';

async function passphraseFromFile(path: string): Promise<string> {
  const source = resolve(path);
  const details = await lstat(source);
  if (!details.isFile()) throw new Error('Passphrase path must be a regular file');
  if (process.platform !== 'win32' && (details.mode & 0o077) !== 0) {
    throw new Error('Passphrase file must be readable only by its owner (chmod 600)');
  }
  const raw = await readFile(source, 'utf8');
  return raw.replace(/\r?\n$/, '');
}

function reportError(error: unknown): never {
  console.error(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function createBackupCommand(ctx: CLIContext): Command {
  const command = new Command('backup')
    .description('Create, verify, and restore encrypted offline state backups')
    .addHelpText('after', formatExamples([
      'xopc backup create --output /secure/xopc-backup --passphrase-file /secure/passphrase',
      'xopc backup verify /secure/xopc-backup --passphrase-file /secure/passphrase',
      'xopc backup restore /secure/xopc-backup --target /new/.xopc --passphrase-file /secure/passphrase',
    ]));

  command.command('create')
    .requiredOption('--output <directory>', 'New backup directory outside the state directory')
    .requiredOption('--passphrase-file <path>', 'File containing a passphrase of at least 12 characters')
    .action(async (options: { output: string; passphraseFile: string }) => {
      try {
        const rel = relative(resolveStateDir(), resolve(options.passphraseFile));
        if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
          throw new Error('Passphrase file must be outside the state directory');
        }
        const manifest = await createStateBackup({
          stateDir: resolveStateDir(), output: options.output,
          passphrase: await passphraseFromFile(options.passphraseFile),
          configPath: ctx.configPath,
          configuredPaths: [ctx.configPath || resolveConfigPath(), resolveCredentialsDir(), ctx.workspacePath],
        });
        console.log(`Backup created: ${resolve(options.output)} (${manifest.entries.length} files, schema ${manifest.schemaVersion})`);
        console.log('Backups contain private conversations and credentials. Keep both the archive and passphrase secure.');
        console.log('This first version covers the state directory and rejects known external workspace, config, and credential paths.');
      } catch (error) { reportError(error); }
    });

  command.command('verify')
    .argument('<directory>', 'Backup directory')
    .requiredOption('--passphrase-file <path>', 'Passphrase file')
    .action(async (directory: string, options: { passphraseFile: string }) => {
      try {
        const manifest = await verifyStateBackup(directory, await passphraseFromFile(options.passphraseFile));
        console.log(`Backup verified: ${manifest.entries.length} files, schema ${manifest.schemaVersion}`);
      } catch (error) { reportError(error); }
    });

  command.command('restore')
    .argument('<directory>', 'Backup directory')
    .requiredOption('--target <directory>', 'New restore directory; must not exist')
    .requiredOption('--passphrase-file <path>', 'Passphrase file')
    .action(async (directory: string, options: { target: string; passphraseFile: string }) => {
      try {
        const manifest = await restoreStateBackup({
          archivePath: directory, target: options.target,
          passphrase: await passphraseFromFile(options.passphraseFile),
        });
        console.log(`Backup restored: ${resolve(options.target)} (${manifest.entries.length} files)`);
        console.log('Review external paths and provider/channel authorization before starting the restored Gateway.');
      } catch (error) { reportError(error); }
    });

  return command;
}

register({
  id: 'backup', name: 'backup',
  description: 'Create, verify, and restore encrypted offline state backups',
  factory: createBackupCommand,
  metadata: { category: 'maintenance', examples: ['xopc backup create --output /secure/backup --passphrase-file /secure/passphrase'] },
});
