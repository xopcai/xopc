import { Command } from 'commander';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { getWorkspaceStatus, setupWorkspace, setupConfig } from '../utils/workspace.js';

function createSetupCommand(ctx: CLIContext): Command {
  const cmd = new Command('setup')
    .description('Initialize config file and workspace directory')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot setup                    # Create config + workspace',
        'xopcbot setup --workspace /path  # Custom workspace path',
      ])
    )
    .option('--workspace <path>', 'Workspace directory path', ctx.workspacePath)
    .action(async (options) => {
      const workspacePath = options.workspace || ctx.workspacePath;
      const configPath = ctx.configPath;

      console.log('🔧 xopcbot Setup\n');
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

      console.log('\n' + '═'.repeat(40));
      console.log('\n✅ Setup complete!\n');

      console.log('📁 Files:');
      console.log('   Config:', configPath);
      console.log('   Workspace:', workspacePath);

      console.log('\n🚀 Next Steps:');
      console.log('   xopcbot onboard              # Run full setup wizard');
      console.log('   xopcbot onboard --model      # Configure model only');
      console.log('   xopcbot onboard --channels  # Configure channels only');
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
      'xopcbot setup',
      'xopcbot setup --workspace ~/.my-workspace',
    ],
  },
});
