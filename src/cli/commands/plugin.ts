// Plugin Management Commands
import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, isAbsolute, resolve } from 'path';
import { DEFAULT_PATHS } from '../../config/index.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import {
  installFromNpm,
  installFromLocal,
  removePlugin,
  listPlugins,
} from '../../plugins/install.js';

function createPluginCommand(_ctx: CLIContext): Command {
  const cmd = new Command('plugin')
    .description('Manage xopcbot plugins')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot plugin list                           # List all plugins',
        'xopcbot plugin install my-plugin              # Install from npm',
        'xopcbot plugin install ./my-local-plugin      # Install from local directory',
        'xopcbot plugin install @scope/my-plugin       # Install scoped npm package',
        'xopcbot plugin remove my-plugin               # Remove a plugin',
        'xopcbot plugin create my-plugin               # Create a new plugin',
      ])
    );

  // Plugin list command
  cmd
    .command('list')
    .description('List all installed plugins')
    .action(async () => {
      const pluginsDir = join(DEFAULT_PATHS.workspace, '.plugins');
      const plugins = listPlugins(pluginsDir);

      console.log('\n📦 Installed Plugins\n');
      console.log('═'.repeat(60));

      if (plugins.length === 0) {
        console.log('No plugins installed.\n');
        console.log('Install a plugin:');
        console.log('  xopcbot plugin install <plugin-name>');
        console.log('  xopcbot plugin install ./local-plugin-dir\n');
        return;
      }

      for (const plugin of plugins) {
        const displayName = plugin.name || plugin.id;
        console.log(`\n  📁 ${displayName}`);
        console.log(`     ID: ${plugin.id}`);
        if (plugin.version) {
          console.log(`     Version: ${plugin.version}`);
        }
        console.log(`     Path: ${plugin.path}`);
      }

      console.log('\n');
    });

  // Plugin install command
  cmd
    .command('install [pluginId]')
    .description('Install a plugin from npm or local path')
    .option('--timeout <ms>', 'Installation timeout in milliseconds', '120000')
    .action(async (pluginId, options) => {
      console.log('');

      if (!pluginId) {
        console.log('❌ Error: Missing plugin identifier');
        console.log('\nUsage:');
        console.log('  xopcbot plugin install <npm-package-name>');
        console.log('  xopcbot plugin install ./local-directory-path');
        console.log('\nExamples:');
        console.log('  xopcbot plugin install my-xopcbot-plugin');
        console.log('  xopcbot plugin install @scope/my-plugin');
        console.log('  xopcbot plugin install ./plugins/my-plugin');
        console.log('');
        process.exit(1);
      }

      const pluginsDir = join(DEFAULT_PATHS.workspace, '.plugins');
      if (!existsSync(pluginsDir)) {
        mkdirSync(pluginsDir, { recursive: true });
      }

      // Detect source type
      const isLocalPath =
        pluginId.startsWith('./') ||
        pluginId.startsWith('../') ||
        pluginId.startsWith('/') ||
        (isAbsolute(pluginId) && existsSync(resolve(pluginId)));

      const timeoutMs = parseInt(options.timeout, 10) || 120000;

      let result;

      if (isLocalPath) {
        console.log(`📦 Installing plugin from local path: ${pluginId}\n`);
        result = await installFromLocal(pluginId, pluginsDir);
      } else {
        console.log(`📦 Installing plugin from npm: ${pluginId}\n`);
        result = await installFromNpm(pluginId, pluginsDir, timeoutMs);
      }

      if (!result.ok) {
        console.log(`\n❌ Installation failed: ${result.error}`);
        console.log('');
        process.exit(1);
      }

      console.log('');
    });

  // Plugin remove command
  cmd
    .command('remove <pluginId>')
    .alias('uninstall')
    .description('Remove an installed plugin')
    .action(async (pluginId) => {
      console.log('');

      const pluginsDir = join(DEFAULT_PATHS.workspace, '.plugins');
      const result = removePlugin(pluginId, pluginsDir);

      if (!result.ok) {
        console.log(`❌ Error: ${result.error}\n`);
        process.exit(1);
      }

      console.log(`✅ Plugin ${pluginId} has been removed.\n`);
      console.log('Note: If the plugin was enabled in config, you should also remove it from your configuration file.\n');
    });

  // Plugin create command
  cmd
    .command('create <pluginId>')
    .description('Create a new plugin scaffold')
    .option('--name <name>', 'Plugin display name')
    .option('--description <desc>', 'Plugin description')
    .option('--kind <kind>', 'Plugin kind: channel|provider|memory|tool|utility')
    .action(async (pluginId, options) => {
      console.log(`\n📦 Creating plugin: ${pluginId}\n`);

      // Validate plugin ID
      if (pluginId.includes('/') || pluginId.includes('\\')) {
        console.log('❌ Error: Plugin ID cannot contain path separators');
        console.log('');
        process.exit(1);
      }

      const pluginsDir = join(DEFAULT_PATHS.workspace, '.plugins');
      if (!existsSync(pluginsDir)) {
        mkdirSync(pluginsDir, { recursive: true });
      }

      const pluginDir = join(pluginsDir, pluginId);
      if (existsSync(pluginDir)) {
        console.log(`❌ Plugin directory already exists: ${pluginDir}\n`);
        process.exit(1);
      }

      mkdirSync(pluginDir, { recursive: true });

      const name = options.name || pluginId;
      const description = options.description || 'A xopcbot plugin';
      const kind = options.kind || 'utility';

      // Create package.json
      const packageJson = {
        name: pluginId,
        version: '0.1.0',
        description,
        main: 'index.ts',
        type: 'module',
        xopcbot: {
          plugin: {
            id: pluginId,
            name,
            description,
            version: '0.1.0',
            kind,
            main: 'index.ts',
          },
        },
      };

      writeFileSync(join(pluginDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      // Create index.ts template
      const indexContent = `/**
 * ${name} - A xopcbot plugin
 *
 * ${description}
 */

import type { PluginApi, PluginDefinition } from 'xopcbot/plugins';

export const plugin: PluginDefinition = {
  id: '${pluginId}',
  name: '${name}',
  description: '${description}',
  version: '0.1.0',
  kind: '${kind}',

  async register(api: PluginApi) {
    api.logger.info('Plugin ${name} registered');

    // TODO: Implement your plugin logic here
    // Examples:
    // - Register tools: api.registerTool({...})
    // - Register hooks: api.registerHook('message_received', handler)
    // - Register commands: api.registerCommand({...})
  },

  async activate(api: PluginApi) {
    api.logger.info('Plugin ${name} activated');
  },

  async deactivate(api: PluginApi) {
    api.logger.info('Plugin ${name} deactivated');
  },
};

export default plugin;
`;

      writeFileSync(join(pluginDir, 'index.ts'), indexContent);

      // Create manifest
      const manifest = {
        id: pluginId,
        name,
        description,
        version: '0.1.0',
        kind,
        main: 'index.ts',
      };

      writeFileSync(join(pluginDir, 'xopcbot.plugin.json'), JSON.stringify(manifest, null, 2));

      // Create README
      const readmeContent = `# ${name}

${description}

## Installation

\`\`\`bash
xopcbot plugin install ${pluginId}
\`\`\`

## Configuration

Add to your xopcbot config:

\`\`\`yaml
plugins:
  enabled: [${pluginId}]
  ${pluginId}:
    # your plugin options here
\`\`\`

## Development

\`\`\`bash
# Create plugin in development mode
xopcbot plugin create ${pluginId} --name "${name}" --kind ${kind}
\`\`\`

## License

MIT
`;

      writeFileSync(join(pluginDir, 'README.md'), readmeContent);

      console.log(`✅ Plugin created: ${pluginDir}\n`);
      console.log('Files created:');
      console.log(`  - package.json`);
      console.log(`  - index.ts`);
      console.log(`  - xopcbot.plugin.json`);
      console.log(`  - README.md`);
      console.log(`\nTo enable this plugin, add to your config:`);
      console.log(`  plugins:`);
      console.log(`    enabled: [${pluginId}]`);
      console.log(`    ${pluginId}:`);
      console.log(`      # your plugin options here\n`);
    });

  // Plugin info command
  cmd
    .command('info <pluginId>')
    .description('Show detailed information about a plugin')
    .action(async (pluginId) => {
      console.log('');

      const pluginsDir = join(DEFAULT_PATHS.workspace, '.plugins');
      const pluginDir = join(pluginsDir, pluginId);

      if (!existsSync(pluginDir)) {
        console.log(`❌ Plugin not found: ${pluginId}\n`);
        process.exit(1);
      }

      const manifestPath = join(pluginDir, 'xopcbot.plugin.json');
      let manifest: { id?: string; name?: string; version?: string; description?: string; kind?: string } | null = null;

      if (existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        } catch {
          // Ignore parse errors
        }
      }

      console.log(`📦 Plugin: ${manifest?.name || pluginId}\n`);
      console.log(`  ID: ${manifest?.id || pluginId}`);
      if (manifest?.version) console.log(`  Version: ${manifest.version}`);
      if (manifest?.kind) console.log(`  Kind: ${manifest.kind}`);
      if (manifest?.description) console.log(`  Description: ${manifest.description}`);
      console.log(`  Path: ${pluginDir}`);
      console.log('');
    });

  return cmd;
}

register({
  id: 'plugin',
  name: 'plugin',
  description: 'Manage xopcbot plugins',
  factory: createPluginCommand,
  metadata: {
    category: 'utility',
    examples: [
      'xopcbot plugin list',
      'xopcbot plugin create my-plugin',
      'xopcbot plugin install my-plugin',
      'xopcbot plugin remove my-plugin',
    ],
  },
});
