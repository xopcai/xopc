// Extension Management Commands
import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_PATHS,
  getDefaultWorkspacePath,
} from '../../config/paths.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import {
  installFromNpm,
  installFromLocal,
  removeExtension,
  listAllExtensions,
  resolveExtensionsDir,
} from '../../extensions/install.js';

function createExtensionCommand(_ctx: CLIContext): Command {
  const cmd = new Command('extension')
    .description('Manage xopcbot extensions')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot extension list                           # List all extensions',
        'xopcbot extension install my-extension              # Install from npm to workspace',
        'xopcbot extension install my-extension --global     # Install to global (~/.xopcbot/extensions/)',
        'xopcbot extension install ./my-local-extension      # Install from local directory',
        'xopcbot extension remove my-extension               # Remove a extension',
        'xopcbot extension create my-extension               # Create a new extension',
      ]),
    );

  // Extension list command
  cmd
    .command('list')
    .description('List all installed extensions from all tiers')
    .action(async () => {
      const workspaceDir = getDefaultWorkspacePath();
      const extensions = listAllExtensions(workspaceDir);

      console.log('\n📦 Installed Extensions\n');
      console.log('═'.repeat(70));

      if (extensions.length === 0) {
        console.log('\nNo extensions installed.\n');
        console.log('Install a extension:');
        console.log('  xopcbot extension install <extension-name>');
        console.log('  xopcbot extension install --global <extension-name>');
        console.log('  xopcbot extension install ./local-extension-dir\n');
        return;
      }

      // Group by origin
      const byOrigin = {
        workspace: extensions.filter((p) => p.origin === 'workspace'),
        global: extensions.filter((p) => p.origin === 'global'),
        bundled: extensions.filter((p) => p.origin === 'bundled'),
      };

      if (byOrigin.workspace.length > 0) {
        console.log('\n  📁 Workspace (./.extensions/)');
        for (const extension of byOrigin.workspace) {
          console.log(`    • ${extension.name || extension.id}${extension.version ? ` @ ${extension.version}` : ''}`);
          console.log(`      ID: ${extension.id}`);
        }
      }

      if (byOrigin.global.length > 0) {
        console.log('\n  🌐 Global (~/.xopcbot/extensions/)');
        for (const extension of byOrigin.global) {
          console.log(`    • ${extension.name || extension.id}${extension.version ? ` @ ${extension.version}` : ''}`);
          console.log(`      ID: ${extension.id}`);
        }
      }

      if (byOrigin.bundled.length > 0) {
        console.log('\n  📦 Bundled (built-in)');
        for (const extension of byOrigin.bundled) {
          console.log(`    • ${extension.name || extension.id}${extension.version ? ` @ ${extension.version}` : ''}`);
          console.log(`      ID: ${extension.id}`);
        }
      }

      console.log('\n');
    });

  // Extension install command
  cmd
    .command('install [extensionId]')
    .description('Install a extension from npm or local path')
    .option('--global', 'Install to global directory (~/.xopcbot/extensions/)')
    .option('--timeout <ms>', 'Installation timeout in milliseconds', '120000')
    .action(async (extensionId, options) => {
      console.log('');

      if (!extensionId) {
        console.log('❌ Error: Missing extension identifier');
        console.log('\nUsage:');
        console.log('  xopcbot extension install <npm-package-name> [--global]');
        console.log('  xopcbot extension install ./local-directory-path [--global]');
        console.log('\nExamples:');
        console.log('  xopcbot extension install my-xopcbot-extension');
        console.log('  xopcbot extension install @scope/my-extension');
        console.log('  xopcbot extension install ./extensions/my-extension');
        console.log('  xopcbot extension install my-extension --global');
        console.log('');
        process.exit(1);
      }

      const isGlobal = options.global === true;
      const workspaceDir = getDefaultWorkspacePath();
      const extensionsDir = resolveExtensionsDir(workspaceDir, isGlobal);

      if (!existsSync(extensionsDir)) {
        mkdirSync(extensionsDir, { recursive: true });
      }

      // Detect source type
      const isLocalPath =
        extensionId.startsWith('./') ||
        extensionId.startsWith('../') ||
        extensionId.startsWith('/') ||
        (extensionId.length > 0 && existsSync(resolveAbsolutePath(extensionId)));

      const timeoutMs = parseInt(options.timeout, 10) || 120000;

      let result;

      if (isLocalPath) {
        const source = isGlobal ? 'global' : 'workspace';
        console.log(`📦 Installing extension from local path to ${source}: ${extensionId}\n`);
        result = await installFromLocal(extensionId, extensionsDir);
      } else {
        const source = isGlobal ? 'global' : 'workspace';
        console.log(`📦 Installing extension from npm to ${source}: ${extensionId}\n`);
        result = await installFromNpm(extensionId, extensionsDir, timeoutMs);
      }

      if (!result.ok) {
        console.log(`\n❌ Installation failed: ${result.error}`);
        console.log('');
        process.exit(1);
      }

      console.log('');
    });

  // Extension remove command
  cmd
    .command('remove <extensionId>')
    .alias('uninstall')
    .description('Remove an installed extension (from workspace or global)')
    .action(async (extensionId) => {
      console.log('');

      const workspaceDir = getDefaultWorkspacePath();
      const result = removeExtension(extensionId, workspaceDir);

      if (!result.ok) {
        console.log(`❌ Error: ${result.error}\n`);
        process.exit(1);
      }

      const location = result.removedFrom === 'global' ? 'global' : 'workspace';
      console.log(`✅ Extension ${extensionId} has been removed from ${location}.\n`);
      console.log('Note: If the extension was enabled in config, you should also remove it from your configuration file.\n');
    });

  // Extension create command
  cmd
    .command('create <extensionId>')
    .description('Create a new extension scaffold')
    .option('--name <name>', 'Extension display name')
    .option('--description <desc>', 'Extension description')
    .option('--kind <kind>', 'Extension kind: channel|provider|memory|tool|utility')
    .action(async (extensionId, options) => {
      console.log(`\n📦 Creating extension: ${extensionId}\n`);

      // Validate extension ID
      if (extensionId.includes('/') || extensionId.includes('\\')) {
        console.log('❌ Error: Extension ID cannot contain path separators');
        console.log('');
        process.exit(1);
      }

      const extensionsDir = join(DEFAULT_PATHS.workspace, '.extensions');
      if (!existsSync(extensionsDir)) {
        mkdirSync(extensionsDir, { recursive: true });
      }

      const extensionDir = join(extensionsDir, extensionId);
      if (existsSync(extensionDir)) {
        console.log(`❌ Extension directory already exists: ${extensionDir}\n`);
        process.exit(1);
      }

      mkdirSync(extensionDir, { recursive: true });

      const name = options.name || extensionId;
      const description = options.description || 'A xopcbot extension';
      const kind = options.kind || 'utility';

      // Create package.json
      const packageJson = {
        name: extensionId,
        version: '0.1.0',
        description,
        main: 'index.ts',
        type: 'module',
        xopcbot: {
          extension: {
            id: extensionId,
            name,
            description,
            version: '0.1.0',
            kind,
            main: 'index.ts',
          },
        },
      };

      writeFileSync(join(extensionDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      // Create index.ts template using xopcbot/extension-sdk
      const indexContent = `/**
 * ${name} - A xopcbot extension
 *
 * ${description}
 */

import type { ExtensionApi, ExtensionDefinition } from 'xopcbot/extension-sdk';

export const extension: ExtensionDefinition = {
  id: '${extensionId}',
  name: '${name}',
  description: '${description}',
  version: '0.1.0',
  kind: '${kind}',

  async register(api: ExtensionApi) {
    api.logger.info('Extension ${name} registered');

    // TODO: Implement your extension logic here
    // Examples:
    // - Register tools: api.registerTool({...})
    // - Register hooks: api.registerHook('message_received', handler)
    // - Register commands: api.registerCommand({...})
  },

  async activate(api: ExtensionApi) {
    api.logger.info('Extension ${name} activated');
  },

  async deactivate(api: ExtensionApi) {
    api.logger.info('Extension ${name} deactivated');
  },
};

export default extension;
`;

      writeFileSync(join(extensionDir, 'index.ts'), indexContent);

      // Create manifest
      const manifest = {
        id: extensionId,
        name,
        description,
        version: '0.1.0',
        kind,
        main: 'index.ts',
      };

      writeFileSync(join(extensionDir, 'xopcbot.extension.json'), JSON.stringify(manifest, null, 2));

      // Create README
      const readmeContent = `# ${name}

${description}

## Installation

\`\`\`bash
# Install from npm
xopcbot extension install ${extensionId}

# Or install from local directory
xopcbot extension install ./${extensionId}
\`\`\`

## Configuration

Add to your xopcbot config:

\`\`\`yaml
extensions:
  enabled: [${extensionId}]
  ${extensionId}:
    # your extension options here
\`\`\`

## Development

\`\`\`bash
# Create extension in development mode
xopcbot extension create ${extensionId} --name "${name}" --kind ${kind}
\`\`\`

## License

MIT
`;

      writeFileSync(join(extensionDir, 'README.md'), readmeContent);

      console.log(`✅ Extension created: ${extensionDir}\n`);
      console.log('Files created:');
      console.log(`  - package.json`);
      console.log(`  - index.ts (using xopcbot/extension-sdk)`);
      console.log(`  - xopcbot.extension.json`);
      console.log(`  - README.md`);
      console.log(`\nTo enable this extension, add to your config:`);
      console.log(`  extensions:`);
      console.log(`    enabled: [${extensionId}]`);
      console.log(`    ${extensionId}:`);
      console.log(`      # your extension options here\n`);
    });

  // Extension info command
  cmd
    .command('info <extensionId>')
    .description('Show detailed information about a extension')
    .action(async (extensionId) => {
      console.log('');

      const workspaceDir = getDefaultWorkspacePath();
      const extensions = listAllExtensions(workspaceDir);
      const extension = extensions.find((p) => p.id === extensionId);

      if (!extension) {
        console.log(`❌ Extension not found: ${extensionId}\n`);
        process.exit(1);
      }

      const manifestPath = join(extension.path, 'xopcbot.extension.json');
      let manifest: { id?: string; name?: string; version?: string; description?: string; kind?: string } | null = null;

      if (existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        } catch {
          // Ignore parse errors
        }
      }

      const originLabel =
        extension.origin === 'workspace'
          ? '📁 Workspace'
          : extension.origin === 'global'
            ? '🌐 Global'
            : '📦 Bundled';

      console.log(`📦 Extension: ${manifest?.name || extension.name || extensionId}\n`);
      console.log(`  Origin: ${originLabel}`);
      console.log(`  ID: ${manifest?.id || extensionId}`);
      if (manifest?.version || extension.version) console.log(`  Version: ${manifest?.version || extension.version}`);
      if (manifest?.kind || extension.kind) console.log(`  Kind: ${manifest?.kind || extension.kind}`);
      if (manifest?.description || extension.name) console.log(`  Description: ${manifest?.description || extension.name}`);
      console.log(`  Path: ${extension.path}`);
      console.log('');
    });

  return cmd;
}

function resolveAbsolutePath(input: string): string {
  if (input.startsWith('/')) return input;
  return join(process.cwd(), input);
}

register({
  id: 'extension',
  name: 'extension',
  description: 'Manage xopcbot extensions',
  factory: createExtensionCommand,
  metadata: {
    category: 'utility',
    examples: [
      'xopcbot extension list',
      'xopcbot extension create my-extension',
      'xopcbot extension install my-extension',
      'xopcbot extension install my-extension --global',
      'xopcbot extension remove my-extension',
    ],
  },
});
