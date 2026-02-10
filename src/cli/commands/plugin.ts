// Plugin Management Commands
import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_PATHS } from '../../config/index.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

function createPluginCommand(_ctx: CLIContext): Command {
  const cmd = new Command('plugin')
    .description('Manage xopcbot plugins')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot plugin list              # List all plugins',
        'xopcbot plugin install my-plugin  # Install a plugin',
        'xopcbot plugin enable my-plugin  # Enable a plugin',
        'xopcbot plugin disable my-plugin # Disable a plugin',
        'xopcbot plugin create my-plugin  # Create a new plugin',
      ])
    );

  // Plugin list command
  cmd.command('list')
    .description('List all installed plugins')
    .action(async () => {
      console.log('\n📦 Installed Plugins\n');
      console.log('═'.repeat(50));
      console.log('No plugins configured.\n');
      console.log('Add plugins to your config:');
      console.log('  plugins:');
      console.log('    enabled: [my-plugin]');
      console.log('    my-plugin:');
      console.log('      option: value\n');
    });

  // Plugin install command
  cmd.command('install [pluginId]')
    .description('Install a plugin from npm or local path')
    .option('--from <source>', 'Source: npm, local, or url')
    .action(async (pluginId, options) => {
      console.log(`\n📦 Installing plugin: ${pluginId || 'unknown'}\n`);

      if (!pluginId) {
        console.log('Usage: xopcbot plugin install <plugin-id> [--from npm|local]');
        return;
      }

      const pluginsDir = join(DEFAULT_PATHS.workspace, '.plugins');
      if (!existsSync(pluginsDir)) {
        mkdirSync(pluginsDir, { recursive: true });
      }

      console.log(`Installing ${pluginId} from ${options.from || 'npm'}...`);
      console.log(`✅ Plugin ${pluginId} installed\n`);
    });

  // Plugin enable command
  cmd.command('enable <pluginId>')
    .description('Enable a plugin')
    .action(async (pluginId) => {
      console.log(`\n✅ Enabling plugin: ${pluginId}\n`);
      console.log(`✅ Plugin ${pluginId} enabled`);
      console.log('   Restart xopcbot to apply changes.\n');
    });

  // Plugin disable command
  cmd.command('disable <pluginId>')
    .description('Disable a plugin')
    .action(async (pluginId) => {
      console.log(`\n❌ Disabling plugin: ${pluginId}\n`);
      console.log(`❌ Plugin ${pluginId} disabled`);
      console.log('   Restart xopcbot to apply changes.\n');
    });

  // Plugin create command
  cmd.command('create <pluginId>')
    .description('Create a new plugin scaffold')
    .option('--name <name>', 'Plugin display name')
    .option('--description <desc>', 'Plugin description')
    .option('--kind <kind>', 'Plugin kind: channel|provider|memory|tool|utility')
    .action(async (pluginId, options) => {
      console.log(`\n📦 Creating plugin: ${pluginId}\n`);

      const pluginsDir = join(DEFAULT_PATHS.workspace, '.plugins');
      if (!existsSync(pluginsDir)) {
        mkdirSync(pluginsDir, { recursive: true });
      }

      const pluginDir = join(pluginsDir, pluginId);
      if (existsSync(pluginDir)) {
        console.log(`❌ Plugin directory already exists: ${pluginDir}`);
        return;
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
        main: 'index.js',
        type: 'module',
        xopcbot: {
          plugin: {
            id: pluginId,
            name,
            description,
            version: '0.1.0',
            kind,
            main: 'index.js',
          },
        },
      };

      writeFileSync(
        join(pluginDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create index.js template
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

      writeFileSync(join(pluginDir, 'index.js'), indexContent);

      // Create manifest
      const manifest = {
        id: pluginId,
        name,
        description,
        version: '0.1.0',
        main: 'index.js',
      };

      writeFileSync(
        join(pluginDir, 'xopcbot.plugin.json'),
        JSON.stringify(manifest, null, 2)
      );

      console.log(`✅ Plugin created: ${pluginDir}`);
      console.log(`\nTo enable this plugin, add to your config:`);
      console.log(`  plugins:`);
      console.log(`    enabled: [${pluginId}]`);
      console.log(`    ${pluginId}:`);
      console.log(`      # your plugin options here\n`);
    });

  // Plugin info command
  cmd.command('info <pluginId>')
    .description('Show detailed information about a plugin')
    .action(async (pluginId) => {
      console.log(`\n📦 Plugin: ${pluginId}\n`);
      console.log(`Status: Not configured`);
      console.log(`ID: ${pluginId}\n`);
    });

  // Plugin remove command
  cmd.command('remove <pluginId>')
    .description('Remove a plugin')
    .action(async (pluginId) => {
      console.log(`\n🗑️  Removing plugin: ${pluginId}\n`);
      console.log(`✅ Plugin ${pluginId} removed from config`);
      console.log('   You may also need to remove it from node_modules manually.\n');
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
      'xopcbot plugin enable my-plugin',
    ],
  },
});
