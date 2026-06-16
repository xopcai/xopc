import { Command } from 'commander';
import { existsSync } from 'fs';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { seedMainAgentProfileMarkdown } from '../../agent/context/workspace-seed.js';
import { initWorkspace } from '../utils/init-workspace.js';

function createSetupCommand(ctx: CLIContext): Command {
  const cmd = new Command('setup')
    .description('Initialize config file and workspace directory')
    .addHelpText(
      'after',
      formatExamples([
        'xopc setup                    # Create config + workspace',
        'xopc setup --workspace /path  # Custom workspace path',
        'xopc init                     # Full state dirs + agent profile seeds',
      ])
    )
    .option('--workspace <path>', 'Workspace directory path', ctx.workspacePath)
    .action(async (options) => {
      const workspacePath = options.workspace || ctx.workspacePath;
      const configPath = ctx.configPath;

      console.log('🔧 xopc Setup\n');
      console.log('═'.repeat(40));

      // Check current status
      const configExists = existsSync(configPath);
      const workspaceExists = existsSync(workspacePath);

      console.log('\n📊 Current Status:');
      console.log(`   Config: ${configExists ? '✅ exists' : '❌ not found'}`);
      console.log(`   Workspace: ${workspaceExists ? '✅ setup' : '❌ not found'}`);

      const result = await initWorkspace({ configPath, workspacePath });

      if (result.configCreated) {
        console.log('\n📝 Created config file.');
      } else {
        console.log('\n📝 Config already present (verified).');
      }

      if (result.workspaceCreated) {
        console.log('\n📁 Created workspace.');
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
      console.log('   xopc init                 # Full Agent OS dirs (optional, beyond setup)');
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
