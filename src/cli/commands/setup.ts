import { Command } from 'commander';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { seedMainAgentProfileMarkdown } from '../../agent/context/workspace-seed.js';
import { getWorkspaceStatus } from '../utils/workspace.js';
import { initWorkspace } from '../utils/init-workspace.js';
import { REGISTRY_COMMAND_MODULES } from '../command-loaders.js';
import { registry } from '../registry.js';
import { serializeSetupManifest } from './setup-shared/index.js';
import { colors } from '../utils/colors.js';

function createSetupCommand(ctx: CLIContext): Command {
  const cmd = new Command('setup')
    .description('Initialize config file and workspace directory')
    .addHelpText(
      'after',
      formatExamples([
        'xopc setup                    # Create config + workspace',
        'xopc setup --workspace /path  # Custom workspace path',
        'xopc setup manifest --json    # Discovery JSON for agents / UIs',
      ])
    )
    .option('--workspace <path>', 'Workspace directory path', ctx.workspacePath)
    .action(async (options) => {
      const workspacePath = options.workspace || ctx.workspacePath;
      const configPath = ctx.configPath;

      console.log('🔧 xopc Setup\n');
      console.log('═'.repeat(40));

      // Check current status
      const status = getWorkspaceStatus(configPath, workspacePath);

      console.log('\n📊 Current Status:');
      console.log(`   Config: ${status.configExists ? '✅ exists' : '❌ not found'}`);
      console.log(`   Workspace: ${status.workspaceSetup ? '✅ setup' : '❌ not found'}`);

      const result = await initWorkspace({ configPath, workspacePath });

      if (result.configCreated) {
        console.log('\n📝 Created config file.');
      } else {
        console.log('\n📝 Config already present (verified).');
      }

      if (result.workspaceCreated) {
        console.log('\n📁 Created workspace + memory/.');
      } else {
        console.log('\n📁 Workspace already present (verified).');
      }

      seedMainAgentProfileMarkdown(result.config);

      console.log('\n' + '═'.repeat(40));
      console.log('\n✅ Setup complete!\n');

      console.log('📁 Files:');
      console.log('   Config:', configPath);
      console.log('   Workspace:', workspacePath);

      console.log('\n🚀 Next Steps:');
      console.log('   xopc onboard              # Run full setup wizard');
      console.log('   xopc onboard --model      # Configure model only');
      console.log('   xopc onboard --channels  # Configure channels only');
    });

  cmd
    .command('manifest')
    .description(
      'Print a discovery JSON describing every configurable domain (for agents / UIs)',
    )
    .option('--json', 'Single-line JSON output suitable for piping (default: pretty)', false)
    .action(async (opts: { json?: boolean }) => {
      // Force-load every command module so each domain's
      // `registerSetupDomain(...)` side effect runs before we serialize. The
      // registry is already initialized at this point, so silence the
      // "registered after initialization" warning during the bulk load.
      registry.setSuppressLateRegistrationWarnings(true);
      try {
        await Promise.all(Object.values(REGISTRY_COMMAND_MODULES).map((load) => load()));
      } finally {
        registry.setSuppressLateRegistrationWarnings(false);
      }
      const manifest = serializeSetupManifest();
      if (opts.json) {
        process.stdout.write(JSON.stringify(manifest) + '\n');
        return;
      }
      if (manifest.domains.length === 0) {
        console.log(colors.gray('No setup domains registered.'));
        return;
      }
      console.log(JSON.stringify(manifest, null, 2));
    });

  return cmd;
}

register({
  id: 'setup',
  name: 'setup',
  description: 'Initialize config file and workspace directory',
  factory: createSetupCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopc setup',
      'xopc setup --workspace ~/.my-workspace',
    ],
  },
});
