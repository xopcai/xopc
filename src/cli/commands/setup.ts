import { Command } from 'commander';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { seedMainAgentBootstrap } from '../../agent/context/workspace-seed.js';
import { loadConfig } from '../../config/loader.js';
import { getWorkspaceStatus, setupWorkspace, setupConfig } from '../utils/workspace.js';

function createSetupCommand(ctx: CLIContext): Command {
  const cmd = new Command('setup')
    .description('Initialize config file and workspace directory')
    .addHelpText(
      'after',
      formatExamples([
        'xopc setup                    # Create config + workspace',
        'xopc setup --workspace /path  # Custom workspace path',
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

      // Setup config
      if (!status.configExists) {
        console.log('\n📝 Creating config file...');
        setupConfig(configPath);
      } else {
        console.log('\n📝 Config already exists, skipping...');
      }

      // Setup workspace
      if (!status.workspaceSetup) {
        console.log('\n📁 Creating workspace...');
        setupWorkspace(workspacePath);
      } else {
        console.log('\n📁 Workspace already setup, skipping...');
      }

      seedMainAgentBootstrap(loadConfig(configPath));

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
